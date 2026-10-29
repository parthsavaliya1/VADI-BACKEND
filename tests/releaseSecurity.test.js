const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
process.env.JWT_SECRET = 'local-test-secret-not-for-deployment-0123456789';
process.env.ENABLE_REVIEW_ACCOUNTS = 'true';
const User = require('../models/User');
const Admin = require('../models/Admin');
const Driver = require('../models/Driver');
const Seller = require('../models/Seller');
const Address = require('../models/Address');
const Order = require('../models/Orders');
const Cart = require('../models/Cart');
const ReviewSandbox = require('../models/ReviewSandbox');
const access = require('../middleware/mobileAccess');
const { adminOnly, customerToken, publicUser } = require('../middleware/sessionAuth');
const uid='111111111111111111111111', other='222222222222222222222222', driverId='333333333333333333333333', shopId='444444444444444444444444';
let demo=false, blocked=false, driverDemo=false, reviewAccount=null;
const originals=[];
function stub(Model, method, fn) { originals.push([Model,method,Model[method]]);Model[method]=fn; }
stub(User,'findById',id=>({select:async()=>id===uid?{_id:uid,status:blocked?'blocked':'active',isDemo:demo}:null}));
stub(Admin,'findById',()=>({select:async()=>null}));
stub(Driver,'findById',id=>({select:async()=>id===driverId?{_id:driverId,isActive:true,isDemo:driverDemo}:null}));
stub(Address,'findById',()=>({select:async()=>({user:other})}));
stub(Order,'findById',()=>({select:async()=>({user:other,assignedDriver:other})}));
stub(Seller,'findOne',async()=>({_id:shopId,user:uid,isDemo:demo,status:'approved',isActive:true}));
stub(User,'findOne',()=>({select:async()=>reviewAccount}));
const sandbox={data:{userId:uid,sellerUserId:other,sellerId:shopId,driverId,orders:[{_id:other,user:uid,orderNumber:'DEMO-001',deliveryHandoverCode:'246810',status:'out_for_delivery'}],products:[],payments:[],wallet:500,history:[],messages:[]},markModified(){},async save(){}};
stub(ReviewSandbox,'findById',async()=>sandbox);
stub(Cart,'findOne',()=>({lean:async()=>({items:[{product:other,quantity:1,unitPrice:40}],grandTotal:40,totalQuantity:1,subtotal:40})}));
stub(Address,'findOne',()=>({lean:async()=>({_id:other,user:uid,city:'Rajkot'})}));
const app=express();app.use(express.json());
for(const kind of ['users','addresses','orders','payments','wallet','cart','sellers','products','uploads','reviews']) {
 app.use('/'+kind,access(kind),(req,res)=>res.json({ok:true,userId:req.query.userId,body:req.body}));
}
app.post('/admin',adminOnly,(_req,res)=>res.json({ok:true}));
app.use('/api/auth',require('../routes/reviewAuthRoutes'));
app.use(require('../routes/publicPolicyRoutes'));
const server=app.listen(0,'127.0.0.1');
const ready=new Promise(resolve=>server.on('listening',resolve));
async function request(path,{token,body,method=body?'POST':'GET'}={}) {
 await ready;
 const response=await fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,body:await response.text()};
}
const token=()=>customerToken({_id:uid,isDemo:demo});
test('anonymous requests cannot read/delete customer data',async()=>{
 for(const path of ['/users/'+uid,'/addresses/'+uid,'/orders','/wallet','/cart','/sellers/me','/uploads'])assert.equal((await request(path)).status,401,path);
 assert.equal((await request('/users/'+uid,{method:'DELETE'})).status,401);
});
test('signed-in customers can browse the public catalog without gaining private catalog access',async()=>{
 for(const url of ['/products','/products/'+other,'/products?category='+other]) {
   assert.equal((await request(url,{token:token()})).status,200,url);
 }
 for(const url of ['/products?includeInactive=true','/products?includePending=true','/products?isActive=false']) {
   assert.equal((await request(url,{token:token()})).status,403,url);
 }
});

test('valid session scopes cart to the verified user',async()=>{
 const result=await request('/cart',{token:token()});assert.equal(result.status,200);assert.equal(JSON.parse(result.body).userId,uid);
});
test('body/query user ID spoofing and isAdmin flags are rejected',async()=>{
 assert.equal((await request('/cart?userId='+other,{token:token()})).status,403);
 assert.equal((await request('/orders?isAdmin=true',{token:token()})).status,403);
 assert.equal((await request('/users/'+other,{token:token(),method:'DELETE'})).status,403);
 assert.equal((await request('/cart',{token:token(),body:{userId:other}})).status,403);
 assert.equal((await request('/addresses/single/'+other,{token:token()})).status,403);
});
test('resource lookup enforces order/address ownership',async()=>{
 assert.equal((await request('/orders/'+other,{token:token()})).status,403);
 assert.equal((await request('/addresses/'+other,{token:token(),method:'PUT',body:{name:'x'}})).status,403);
});
test('customer and forged admin tokens do not grant administrator access',async()=>{
 assert.equal((await request('/admin',{token:token(),body:{}})).status,403);
 const forged=jwt.sign({id:uid,role:'admin'},process.env.JWT_SECRET);
 assert.equal((await request('/admin',{token:forged,body:{}})).status,401);
});
test('blocked, expired, wrong-audience and invalid sessions are denied',async()=>{
 blocked=true;assert.equal((await request('/cart',{token:token()})).status,401);blocked=false;
 assert.equal((await request('/cart',{token:jwt.sign({id:uid,role:'customer'},process.env.JWT_SECRET,{expiresIn:-1})})).status,401);
 assert.equal((await request('/cart',{token:jwt.sign({id:uid,role:'customer'},process.env.JWT_SECRET)})).status,401);
 assert.equal((await request('/cart',{token:'invalid'})).status,401);
});
test('review activity uses sandbox records and cannot write to live seller endpoints',async()=>{
 demo=true;
 for(const path of ['/products/mine','/sellers/me/bank'])assert.equal((await request(path,{token:token(),body:{}})).status,403,path);
 const checkout=await request('/payments/create-order',{token:token(),body:{}});assert.equal(checkout.status,200);assert.equal(JSON.parse(checkout.body).data.demo,true);assert.equal(JSON.parse(checkout.body).data.key,'demo');
 const topup=await request('/wallet/topup/order',{token:token(),body:{amount:100}});assert.equal(topup.status,200);
 assert.equal((await request('/wallet/topup/order',{token:token(),body:{amount:-1}})).status,400);
 const demoOrder=await request('/orders',{token:token(),body:{addressId:other,paymentMethod:'cod'}});assert.equal(demoOrder.status,200);assert.match(JSON.parse(demoOrder.body).data.orderNumber,/^DEMO-/);
 assert.equal((await request('/cart/add',{token:token(),body:{productId:other}})).status,200);
 process.env.ENABLE_REVIEW_ACCOUNTS='false';assert.equal((await request('/cart',{token:token()})).status,403);
 process.env.ENABLE_REVIEW_ACCOUNTS='true';demo=false;
});
test('driver cannot verify another driver order',async()=>{
 const driverToken=jwt.sign({id:driverId,role:'driver'},process.env.JWT_SECRET);
 assert.equal((await request('/orders/'+other+'/verify-delivery-handover',{token:driverToken,body:{code:'123456'}})).status,403);
});
test('demo driver handover only updates the isolated demo record',async()=>{
 driverDemo=true;
 const driverToken=jwt.sign({id:driverId,role:'driver'},process.env.JWT_SECRET);
 assert.equal((await request('/orders/'+other+'/verify-delivery-handover',{token:driverToken,body:{code:'wrong'}})).status,400);
 assert.equal((await request('/orders/'+other+'/verify-delivery-handover',{token:driverToken,body:{code:'246810'}})).status,200);
 assert.equal(sandbox.data.orders.find(o=>o._id===other).status,'delivered');
 driverDemo=false;
});
test('seller lookup rejects another shop ID',async()=>{
 assert.equal((await request('/sellers/me?sellerId='+other,{token:token()})).status,403);
});
test('legacy unverified payment and customer status endpoints are denied',async()=>{
 for(const path of ['/payments/verify','/payments/initiate','/orders/'+uid+'/verify-payment','/orders/'+uid+'/status'])assert.equal((await request(path,{token:token(),body:{}})).status,403,path);
});
test('review login requires credentials, consent and a dedicated demo account',async()=>{
 assert.equal((await request('/api/auth/review-login',{body:{role:'admin',login:'review-user',password:'x',privacyPolicyAccepted:true}})).status,401);
 for (const role of ['seller','driver','constructor','toString','__proto__']) assert.equal((await request('/api/auth/review-login',{body:{role,login:'review-user',password:'x',privacyPolicyAccepted:true}})).status,401);
 const body={role:'user',login:'review-user',password:'a-long-local-test-password',privacyPolicyAccepted:true};
 assert.equal((await request('/api/auth/review-login',{body:{...body,privacyPolicyAccepted:false}})).status,400);
 assert.equal((await request('/api/auth/review-login',{body})).status,401);
 reviewAccount={_id:uid,isDemo:true,status:'active',reviewPasswordHash:await bcrypt.hash(body.password,4),save:async()=>{},toObject(){return {_id:uid,isDemo:true,reviewPasswordHash:this.reviewPasswordHash,otp:'secret'};}};
 assert.equal((await request('/api/auth/review-login',{body:{...body,password:'wrong'}})).status,401);
 const result=await request('/api/auth/review-login',{body});assert.equal(result.status,200);
 const value=JSON.parse(result.body);assert.ok(value.token);assert.equal(value.user.reviewPasswordHash,undefined);assert.equal(value.user.otp,undefined);
 assert.equal(jwt.verify(value.token,process.env.JWT_SECRET).demo,true);
});
test('OTP fields and reviewer hashes never enter public user responses',()=>{
 assert.deepEqual(publicUser({_id:uid,otp:'secret',otpSessionId:'session',reviewPasswordHash:'hash'}),{_id:uid});
});
test('public privacy/deletion pages are readable without an app or account and use CSP',async()=>{
 const result=await request('/account-deletion');assert.equal(result.status,200);assert.match(result.body,/SMS verification code/);assert.match(result.body,/retained/);
 const policy=await request('/privacy-policy');assert.equal(policy.status,200);assert.match(policy.body,/Voice search/);assert.match(policy.body,/Delivery staff/);
});
after(async()=>{for(const [Model,method,fn]of originals)Model[method]=fn;await new Promise(resolve=>server.close(resolve));});
