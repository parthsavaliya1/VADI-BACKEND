const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
require('dotenv').config({ path: path.join(__dirname,'../.env'), quiet: true });
const mongoose = require('mongoose');
const express = require('express');
const access = require('../middleware/mobileAccess');
const User = require('../models/User');
async function main() {
  // This command exercises the local revised server against only the seeded demo customer account.
  process.env.ENABLE_REVIEW_ACCOUNTS = 'true';
  const credentials = JSON.parse(fs.readFileSync(path.join(__dirname,'../.review-credentials.local.json'),'utf8'));
  await mongoose.connect(process.env.MONGO_URI,{serverSelectionTimeoutMS:15000});
  const app=express();app.use(express.json());
  app.use('/api/auth',require('../routes/authRoutes'));
  app.use('/sellers',access('sellers'),require('../routes/sellerRoutes'));
  app.use('/orders',access('orders'),require('../routes/orderRoute'));
  app.use('/wallet',access('wallet'),require('../routes/walletRoutes'));
  app.use('/api/driver',require('../routes/driverAuthRoutes'));
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  const base='http://127.0.0.1:'+server.address().port;
  const call=async(url,token,body)=>{
    const result=await fetch(base+url,{method:body?'POST':'GET',signal:AbortSignal.timeout(20000),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const value=await result.json();assert.equal(result.status,200,`${url}: ${value.message||value.error||result.status}`);return value;
  };
  try {
    const sessions={};
    for(const [role,entry]of Object.entries({ user: credentials.user })) {
      await call('/api/auth/send-otp',null,{phone:entry.phone,mode:'login'});
      const session=await call('/api/auth/verify-otp',null,{phone:entry.phone,otp:entry.otp,privacyPolicyAccepted:true});
      assert.ok(session.token);sessions[role]=session;console.log(`PASS ${entry.phone}: standard phone/code sign-in`);
    }
    const customer=sessions.user;
    assert.ok((await call('/orders?userId='+customer.user._id,customer.token)).data.length);
    assert.ok((await call('/wallet?userId='+customer.user._id,customer.token)).data.balance>=0);
    const own=await User.findOne({phone:credentials.user.phone,isDemo:true});assert.ok(own);
    const forbidden=await fetch(base+'/orders?userId='+'222222222222222222222222',{headers:{Authorization:'Bearer '+customer.token}});assert.equal(forbidden.status,403);
    console.log('PASS customer wallet/orders and cross-account isolation');
    console.log('Only local server and demo records were used; nothing was deployed or charged.');
  } finally { await new Promise(resolve=>server.close(resolve));await mongoose.disconnect(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
