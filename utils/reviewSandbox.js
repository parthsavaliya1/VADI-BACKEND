const mongoose = require('mongoose');
const ReviewSandbox = require('../models/ReviewSandbox');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Address = require('../models/Address');
const Category = require('../models/Category');
const id = () => String(new mongoose.Types.ObjectId());
const now = () => new Date().toISOString();
const deny = (res, text) => res.status(403).json({ success: false, message: text });
async function getState(userId) {
  const sandboxId = `play-review-${userId}`;
  const existing = await ReviewSandbox.findById(sandboxId);
  if (existing) return existing;
  const [user, category] = await Promise.all([
    User.findOne({ _id: userId, isDemo: true }).lean(),
    Category.findOne({}).lean(),
  ]);
  if (!user) throw new Error('Create the review customer account first');
  // Fixture identities exist only inside the sandbox, never as login accounts.
  const seller = { _id: id(), user: id(), name: 'Demo shop' };
  const driver = { _id: id() };
  const product = { _id: id(), name: 'Demo tomatoes (test only)', description: 'Sample item in the review sandbox. No real product is published.', category: category?._id || id(), unit: 'kg', isActive: true, approvalStatus: 'approved', variants: [{ _id: id(), packSize: 1, packUnit: 'kg', price: 40, mrp: 50, stock: 100, isActive: true, isDefault: true }] };
  const item = { product: { _id: product._id, name: product.name }, productName: product.name, variantId: product.variants[0]._id, packSize: 1, packUnit: 'kg', unitPrice: 40, quantity: 1, subtotal: 40, seller: { sellerId: String(seller._id), sellerName: seller.name } };
  const sample = { _id: id(), user: String(user._id), orderNumber: 'DEMO-REVIEW-001', items: [item], totalItems: 1, totalQuantity: 1, subtotal: 40, totalDiscount: 0, taxAmount: 0, deliveryFee: 0, grandTotal: 40, status: 'out_for_delivery', payment: { method: 'cod', status: 'pending', isCod: true }, address: { addressId: id(), snapshot: { name: 'Demo Customer', phone: '9990000101', addressLine1: 'Demo delivery address', city: 'Rajkot', state: 'Gujarat', pincode: '360001' } }, assignedDriver: String(driver._id), deliveryHandoverCode: '246810', createdAt: now(), updatedAt: now(), isDemo: true, notes: 'Sandbox order: no delivery or charge' };
  return ReviewSandbox.findOneAndUpdate({ _id: sandboxId }, { $setOnInsert: { data: { userId: String(user._id), sellerUserId: String(seller.user), sellerId: String(seller._id), driverId: String(driver._id), products: [product], orders: [sample], payments: [], wallet: 500, history: [], messages: [] } } }, { upsert: true, new: true });
}
async function handleReviewRequest(kind, req, res) {
  if (!req.auth?.demo) return false;
  const a = req.auth, parts = req.path.split('/').filter(Boolean), method = req.method;
  for (const source of [req.query, req.body || {}]) {
    if (source.userId && String(source.userId) !== a.userId) { deny(res, 'Review account access denied'); return true; }
    if (source.isAdmin && String(source.isAdmin) !== 'false') { deny(res, 'Admin access required'); return true; }
  }
  const handledKinds = ['orders','payments','wallet','sellers','products','driver','support','addresses'];
  if (!handledKinds.includes(kind)) return false;
  const doc = await getState(a.userId), state = doc.data;
  const save = async () => { doc.markModified('data'); await doc.save(); };
  const ok = data => { res.json({ success: true, demo: true, data, message: 'Demo sandbox only — no live changes or charges' }); return true; };
  const fail = message => { res.status(400).json({ success: false, demo: true, message }); return true; };
  if (kind === 'addresses') {
    if (a.userId !== state.userId) return false;
    if (!state.addresses) {
      state.addresses = [{ _id: id(), user: a.userId, type: 'home', name: 'Demo Customer', phone: '9990000101', addressLine1: 'Demo review address - no delivery', city: 'Rajkot', state: 'Gujarat', pincode: '360001', isDefault: true, location: { type: 'Point', coordinates: [70.8022,22.3039] }, createdAt: now(), updatedAt: now() }];
      await save();
    }
    if (method === 'GET') {
      if (parts[0] === 'single') { const value=state.addresses.find(x=>x._id===parts[1]);if(!value)return fail('Demo address not found');res.json(value);return true; }
      if (parts[0] !== a.userId) { deny(res,'Address access denied');return true; }
      res.json(parts[1]==='default'?state.addresses.find(x=>x.isDefault)||null:parts[1]==='type'?state.addresses.filter(x=>x.type===parts[2]):state.addresses);return true;
    }
    if (method === 'POST' && parts.length === 0) {
      if(state.addresses.length>=3)return fail('A maximum of 3 addresses is allowed');
      const value={_id:id(),user:a.userId,type:req.body.type||'home',name:String(req.body.name||''),phone:String(req.body.phone||''),addressLine1:String(req.body.addressLine1||''),city:'Rajkot',state:'Gujarat',pincode:String(req.body.pincode||''),location:req.body.location,isDefault:Boolean(req.body.isDefault),createdAt:now(),updatedAt:now()};
      const error=require('./deliveryZone').assertDeliverableRajkotAddress(value);if(error)return fail(error);
      if(value.isDefault)state.addresses.forEach(x=>x.isDefault=false);
      state.addresses.push(value);await save();res.status(201).json(value);return true;
    }
    const value=state.addresses.find(x=>x._id===parts[0]);if(!value)return fail('Demo address not found');
    if(method==='DELETE'){state.addresses=state.addresses.filter(x=>x._id!==value._id);if(state.addresses.length&&!state.addresses.some(x=>x.isDefault))state.addresses[0].isDefault=true;await save();return ok({});}
    if(method==='PUT'){
      if(parts[1]==='default')state.addresses.forEach(x=>x.isDefault=x._id===value._id);
      else {for(const key of ['type','name','phone','addressLine1','addressLine2','landmark','pincode','location'])if(req.body[key]!==undefined)value[key]=req.body[key];const error=require('./deliveryZone').assertDeliverableRajkotAddress(value);if(error)return fail(error);}
      value.updatedAt=now();await save();res.json(value);return true;
    }
    return false;
  }
  if (kind === 'products') {
    if (method === 'GET') {
      const product = state.products.find(p => p._id === parts[0]);
      return product ? ok(product) : false;
    }
    if (method !== 'POST' || req.path !== '/mine' || a.userId !== state.sellerUserId) return false;
    if (!req.body.name || !Array.isArray(req.body.variants) || !req.body.variants.length) return fail('Name and variants are required');
    const product = { _id: id(), name: String(req.body.name).slice(0,200), description: String(req.body.description || '').slice(0,4000), category: req.body.category, unit: req.body.unit, image: req.body.image || '', isActive: false, approvalStatus: 'pending', variants: req.body.variants.slice(0,20).map(v => ({ ...v, _id: id() })) };
    state.products.unshift(product); state.products = state.products.slice(0,50); await save(); return ok(product);
  }
  if (kind === 'sellers') {
    if (a.userId !== state.sellerUserId) return false;
    for (const source of [req.query, req.body || {}]) if ((source.sellerId || source.id) && String(source.sellerId || source.id) !== state.sellerId) { deny(res, 'Review seller access denied'); return true; }
    if (req.path === '/me/products' && method === 'GET') return ok(state.products);
    if (parts[0] === 'me' && parts[1] === 'products' && method === 'PUT') {
      const product = state.products.find(p => p._id === parts[2]); if (!product) return fail('Demo product not found');
      for (const key of ['name','description','category','unit','image','variants']) if (req.body[key] !== undefined) product[key] = req.body[key];
      await save(); return ok(product);
    }
    if (req.path === '/me/orders' && method === 'GET') return ok(state.orders);
    // The mobile seller screen loads its own real demo profile; other live writes remain blocked.
    return false;
  }
  if (kind === 'driver') {
    if (a.role !== 'driver' || a.id !== state.driverId) { deny(res, 'Driver access denied'); return true; }
    if (req.path === '/deliveries' && method === 'GET') return ok({ assigned: state.orders.filter(o => !['delivered','cancelled'].includes(o.status)), completed: state.orders.filter(o => o.status === 'delivered'), pendingAdmin: [] });
    if (req.path === '/location' && method === 'POST') {
      const lat=Number(req.body.lat), lng=Number(req.body.lng);
      if (!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180) return fail('Valid coordinates are required');
      // Simulated location is intentionally not persisted as a reviewer's personal GPS position.
      return ok({ simulated: true });
    }
    return false;
  }
  if (kind === 'orders') {
    if (a.role === 'driver') {
      if (parts[1] !== 'verify-delivery-handover' || method !== 'POST' || a.id !== state.driverId) return false;
      const order = state.orders.find(o => o._id === parts[0] || o.orderNumber === parts[0].replace(/^#/,''));
      if (!order || String(req.body.code) !== order.deliveryHandoverCode) return fail('Demo order or code is incorrect');
      order.status = 'delivered'; order.deliveredAt=now();order.updatedAt=now(); await save();return ok(order);
    }
    if (a.userId !== state.userId) { deny(res, 'Use the customer review account for demo orders'); return true; }
    if (method === 'GET' && parts.length === 0) return ok(state.orders);
    if (method === 'POST' && parts.length === 0) {
      const cart = await Cart.findOne({ user: a.userId, status: 'active' }).lean();
      const address = state.addresses?.find(x=>x._id===req.body.addressId) || await Address.findOne({ _id: req.body.addressId, user: a.userId }).lean();
      if (!cart?.items?.length || !address) return fail('Add items and select your demo delivery address');
      const order = { ...state.orders[0], _id: id(), user: a.userId, orderNumber: 'DEMO-'+Date.now(), items: cart.items, totalItems: cart.items.length, totalQuantity: cart.totalQuantity, subtotal: cart.subtotal, grandTotal: cart.grandTotal, address: { addressId: String(address._id), snapshot: address }, status: 'confirmed', payment: { method: req.body.paymentMethod, status: req.body.paymentMethod === 'cod' ? 'pending' : 'paid', isCod: req.body.paymentMethod === 'cod' }, createdAt: now(), updatedAt: now(), deliveryHandoverCode: '246810' };
      state.orders.unshift(order);state.orders=state.orders.slice(0,50);await save();return ok(order);
    }
    const ref = parts[0] === 'number' ? parts[1] : parts[0];
    const order=state.orders.find(o=>o._id===ref||o.orderNumber===ref);
    if (!order) return fail('Demo order not found');
    if (method === 'GET') return ok(order);
    if (parts[1] === 'cancel') order.status='cancelled';
    else if (parts[1] === 'return') order.returnRequest={status:'pending',reason:String(req.body.reason||'Demo return'),requestedAt:now()};
    else if (!['repeat','reorder'].includes(parts[1])) return false;
    order.updatedAt=now();await save();return ok(order);
  }
  if (kind === 'wallet') {
    if (a.userId !== state.userId) { deny(res,'Use the customer review account');return true; }
    if (method === 'GET') return ok(req.path==='/history'?state.history:{balance:state.wallet,currency:'INR'});
    if (req.path==='/topup/order') {
      const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<1||amount>10000)return fail('Choose an amount from 1 to 10000');
      const payment={id:'demo_'+id(),amount,kind:'topup',verified:false};state.payments.unshift(payment);state.payments=state.payments.slice(0,50);await save();return ok({key:'demo',amount,amountInPaise:Math.round(amount*100),currency:'INR',razorpayOrderId:payment.id,demo:true});
    }
    if (req.path==='/topup/verify') {
      const payment=state.payments.find(p=>p.id===req.body.razorpayOrderId&&p.kind==='topup');if(!payment)return fail('Demo payment not found');
      if(!payment.verified){payment.verified=true;state.wallet+=payment.amount;state.history.unshift({_id:id(),type:'credit',amount:payment.amount,balanceAfter:state.wallet,description:'Simulated top-up; no money charged',createdAt:now()});await save();}
      return ok({balance:state.wallet});
    }
    return false;
  }
  if (kind === 'payments') {
    if(a.userId!==state.userId){deny(res,'Use the customer review account');return true;}
    if(req.path==='/create-order'&&method==='POST') {
      const cart=await Cart.findOne({user:a.userId,status:'active'}).lean();if(!cart?.items?.length)return fail('Your cart is empty');
      const amount=Number(cart.grandTotal)||0;const payment={id:'demo_'+id(),amount,kind:'order',verified:false};state.payments.unshift(payment);state.payments=state.payments.slice(0,50);await save();return ok({key:'demo',amount,amountInPaise:Math.round(amount*100),currency:'INR',razorpayOrderId:payment.id,demo:true});
    }
    if(req.path==='/verify-signature'&&method==='POST'){const payment=state.payments.find(p=>p.id===req.body.razorpayOrderId);if(!payment)return fail('Demo payment not found');payment.verified=true;await save();return ok({simulated:true});}
    return method==='GET'?ok([]):false;
  }
  if(kind==='support'&&a.userId===state.userId){
    if(method==='GET')return ok(state.messages);
    if(method==='POST'){const text=String(req.body.body||'').trim();if(text.length<2)return fail('Write a message');const message={_id:id(),body:text.slice(0,1000),from:'customer',createdAt:now()};state.messages.push(message);state.messages=state.messages.slice(-50);await save();return ok(message);}
  }
  return false;
}
module.exports = { handleReviewRequest, getState };
