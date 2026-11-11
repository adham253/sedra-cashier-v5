'use strict';
/* Sedra V5.2.2 — UI fixes only. Original IndexedDB, invoice and stock records remain untouched. */

/* 1. Dedicated incoming-stock tab and read-only, itemized historical purchase invoices. */
const v522OriginalSwitchPage=switchPage;
switchPage=function(page){v522OriginalSwitchPage(page);if(page==='purchases')v522RenderPurchases().catch(e=>{console.error(e);toast('تعذر تحميل تفاصيل الوارد')})};

function v522PurchaseSort(a,b){return String(b.createdAt||'').localeCompare(String(a.createdAt||''))}
async function v522RenderPurchases(){
  const list=await all('purchases'),entries=list.slice().sort(v522PurchaseSort),filter=norm($('#purchaseSearch')?.value||''),dt=$('#purchaseDate')?.value||'';
  const matching=entries.filter(p=>(!dt||p.dateKey===dt||p.documentDate===dt)&&(!filter||[p.number,p.supplier,p.reference,...(p.rows||[]).flatMap(r=>[r.productName,r.productCode])].some(v=>norm(v).includes(filter))));
  const total=matching.reduce((s,x)=>s+Number(x.totalC||0),0),paid=matching.reduce((s,x)=>s+Number(x.paidC||0),0);
  const balances=await supplierBalances(),debt=balances.reduce((s,x)=>s+x.amountC,0);
  $('#purchaseOverview').innerHTML=`<div class="stat"><small>فواتير الوارد المطابقة</small><b>${matching.length}</b></div><div class="stat"><small>قيمة الوارد</small><b>${money(total)}</b></div><div class="stat"><small>مدفوع عند تسجيل الوارد</small><b>${money(paid)}</b></div><div class="stat"><small>مديونية الموردين الحالية (كل الفواتير)</small><b class="amber">${money(debt)}</b></div>`;
  $('#purchaseList').innerHTML=matching.length?matching.map(p=>`<div class="list-card tap" data-v522purchase="${esc(p.id)}"><div class="card-top"><strong>${esc(p.number||'فاتورة وارد')}</strong><b>${money(p.totalC||0)}</b></div><div class="card-meta">${esc(p.documentDate||p.dateKey||'')} · ${esc(p.supplier||'مورد غير محدد')} · ${(p.rows||[]).length} سطر</div><div class="card-meta">المدفوع وقت التسجيل ${money(p.paidC||0)} · آجل ${money(p.dueC||0)}</div><span class="badge">اضغط لعرض تفاصيل الأصناف</span></div>`).join(''):'<div class="blank">لا توجد فواتير وارد مطابقة</div>';
  $$('#purchaseList [data-v522purchase]').forEach(el=>el.onclick=()=>v522PurchaseDetails(el.dataset.v522purchase));
  const container=$('#supplierAccounts');
  container.innerHTML=balances.length?balances.map(x=>`<div class="list-card split"><span>${esc(x.supplier)}</span><b class="amber">${money(x.amountC)}</b></div>`).join(''):'<div class="hint">لا توجد مديونيات مستحقة للموردين.</div>';
}
async function v522PurchaseDetails(id){
  const p=await one('purchases',id);if(!p)return toast('فاتورة الوارد غير موجودة');
  const rows=Array.isArray(p.rows)?p.rows:[];
  const body=rows.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${esc(r.productName||'صنف غير مسمى')}</strong><div class="hint">${esc(r.productCode||'')}</div></td><td>${esc(r.unitName||r.way||'وحدة')}</td><td>${fmt(r.qty||0)}</td><td>${money(r.unitCostC||0)}</td><td>${money(r.totalC||0)}</td></tr>`).join('');
  modal('تفاصيل فاتورة وارد — '+(p.number||''),`<div class="list-card"><b>${esc(p.number||'فاتورة وارد')}</b><div class="card-meta">تاريخ المستند: ${esc(p.documentDate||p.dateKey||'')} · تاريخ التسجيل: ${p.createdAt?dateShow(p.createdAt):'غير متوفر'}</div><div class="card-meta">المورد: ${esc(p.supplier||'غير محدد')} · المرجع: ${esc(p.reference||'—')}</div></div><div class="sedra-table-scroll"><table class="sedra-incoming-table"><thead><tr><th>#</th><th>الصنف</th><th>وحدة الوارد</th><th>الكمية</th><th>تكلفة الوحدة</th><th>إجمالي السطر</th></tr></thead><tbody>${body||'<tr><td colspan="6">تفاصيل أصناف الوارد غير محفوظة في هذه الفاتورة القديمة</td></tr>'}</tbody></table></div><div class="sedra-invoice-meta"><div class="stat"><small>قيمة الوارد</small><b>${money(p.totalC||0)}</b></div><div class="stat"><small>المدفوع وقت الوارد</small><b>${money(p.paidC||0)}</b></div><div class="stat"><small>آجل عند تسجيل الفاتورة</small><b>${money(p.dueC||0)}</b></div><div class="stat"><small>عدد السطور</small><b>${rows.length}</b></div></div><p class="sedra-small-note">هذه نسخة محفوظة من فاتورة الوارد وقت اعتمادها، وليست تعديلًا لرصيد المخزون.</p>`);
}
$('#purchaseReload').onclick=()=>v522RenderPurchases();
$('#purchaseSearch').addEventListener('input',()=>v522RenderPurchases());
$('#purchaseDate').addEventListener('change',()=>v522RenderPurchases());

/* 2. Current purchase-cost warning is independent of old invoice cost snapshots. */
let v522ProductView='all';
function v522CostUnknown(p){return priceForBase(p)===null}
function v522SetProductView(mode){v522ProductView=mode;stockOnly=mode==='low';
  for(const [id,v] of [['showAllProducts','all'],['showLowProducts','low'],['showUnknownCost','unknown']])$('#'+id).className='btn small '+(mode===v?'primary':'outline');
  renderProducts();}
renderProducts=async function(){
  const allp=(await all('products')).filter(p=>p.active!==false),v=norm($('#productSearch').value);
  const low=allp.filter(p=>p.stockQty<=p.lowStockBase),negative=allp.filter(p=>p.stockQty<0),unknown=allp.filter(v522CostUnknown),notVerified=allp.filter(p=>p.stockStatus==='unverified');
  $('#stockSummary').innerHTML=`<div class="stock-pill"><small>الأصناف</small><b>${allp.length}</b></div><div class="stock-pill stock-warning"><small>قرب النفاد</small><b>${low.length}</b></div><div class="stock-pill stock-negative"><small>بالسالب</small><b>${negative.length}</b></div><div class="stock-pill stock-warning"><small>شراء مجهول</small><b>${unknown.length}</b></div>`;
  const results=allp.filter(p=>(v522ProductView!=='low'||p.stockQty<=p.lowStockBase)&&(v522ProductView!=='unknown'||v522CostUnknown(p))&&(!v||norm(p.name).includes(v)||norm(p.code).includes(v)||norm(p.barcode).includes(v)))
    .sort((a,b)=>(v522CostUnknown(a)?0:1)-(v522CostUnknown(b)?0:1)||(a.stockQty<0?0:a.stockQty<=a.lowStockBase?1:2)-(b.stockQty<0?0:b.stockQty<=b.lowStockBase?1:2)||a.name.localeCompare(b.name,'ar')).slice(0,150);
  $('#productList').innerHTML=`<div class="hint">${v522ProductView==='unknown'?'تكلفة شراء مجهولة · ':v522ProductView==='low'?'النواقص فقط · ':''}${notVerified.length?'غير مجرود: '+notVerified.length+' · ':''}المعروض ${results.length} صنف</div>`+(results.length?results.map(p=>`<div class="list-card tap" data-product="${esc(p.id)}"><div class="card-top"><strong>${esc(p.name)}</strong><b>${money(p.priceC)}</b></div><div class="card-meta">${esc(p.code||p.id)} · ${esc(isWeight(p)?'سعر الكيلو':p.unit)} · <span class="stock-line ${p.stockQty<0?'dangerTxt':p.stockQty<=p.lowStockBase?'amber':''}">${esc(displayStock(p))}</span></div>${p.stockQty<0?'<span class="badge red">رصيد دفتري سالب</span>':p.stockQty<=p.lowStockBase?'<span class="badge amber">قرب النفاد</span>':''}${v522CostUnknown(p)?'<span class="badge amber">⚠ سعر الشراء مجهول</span>':p.costEstimateDueToLegacyStock?'<span class="badge amber">⚠ تكلفة المخزون تقديرية</span>':''}</div>`).join(''):'<div class="blank">لا توجد نتائج مطابقة</div>');
  $$('#productList [data-product]').forEach(el=>el.onclick=()=>productDetails(el.dataset.product));
};
$('#showAllProducts').onclick=()=>v522SetProductView('all');
$('#showLowProducts').onclick=()=>v522SetProductView('low');
$('#showUnknownCost').onclick=()=>v522SetProductView('unknown');
$('#productSearch').oninput=renderProducts;

/* 3. Product barcode camera searches the products page; it never adds to a sale. */
let v522Scanning=false;
$('#productCamera').onclick=async()=>{
  modal('بحث عن صنف بالكاميرا',`<p class="help">امسح الباركود لفتح نتيجة الصنف في صفحة الأصناف، بدون إضافته لفاتورة البيع.</p><video id="v522ProductVideo" class="camera" autoplay playsinline muted></video><p id="v522ProductCameraState" class="hint">فتح الكاميرا...</p>${field('v522ManualBarcode','أو اكتب الباركود','','text')}<button class="btn secondary block" id="v522ManualSearch">بحث بهذا الباركود</button>`);
  const applyCode=async code=>{const txt=String(code||'').trim();if(!txt)return toast('اكتب الباركود');stopScanner();closeModal();$('#productSearch').value=txt;v522SetProductView('all');const found=(await all('products')).find(p=>p.active!==false&&(p.barcode===txt||p.code===txt));if(found)toast('تم العثور على '+found.name);else toast('الباركود غير موجود ضمن الأصناف')};
  $('#v522ManualSearch').onclick=()=>applyCode($('#v522ManualBarcode').value);
  $('#v522ManualBarcode').onkeydown=e=>{if(e.key==='Enter')applyCode(e.target.value)};
  const el=$('#v522ProductCameraState');
  if(!navigator.mediaDevices?.getUserMedia){el.textContent='الكاميرا غير متاحة في هذا المتصفح. اكتب الباركود بدلًا منها.';return}
  try{
    scannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    const video=$('#v522ProductVideo');if(!video||$('#overlay').hidden){stopScanner();return}
    video.srcObject=scannerStream;await video.play();
    if(!('BarcodeDetector' in window)){el.textContent='الكاميرا شغالة، لكن قارئ الباركود غير مدعوم في المتصفح الحالي. يمكن كتابة الكود.';return}
    const detector=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf']});el.textContent='وجّه الكاميرا إلى الباركود';
    scannerTimer=setInterval(async()=>{if(v522Scanning||!scannerStream)return;v522Scanning=true;try{const found=await detector.detect(video);const code=found?.[0]?.rawValue;if(code)await applyCode(code)}catch(e){console.warn('product camera',e)}finally{v522Scanning=false}},450);
  }catch(e){stopScanner();el.textContent='تعذر تشغيل الكاميرا، راجع الأذونات أو اكتب الباركود يدويًا.'}
};

/* 4. Administrative PIN recovery: requires an actual matching cashier JSON backup.
   No data is imported and no PIN is silently reset. */
function v522CleanPin(x){return String(x??'').trim().replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))}
async function v522AuditPin(action){const tx=db.transaction('audit','readwrite');tx.objectStore('audit').add({id:uid('AU'),action,actor:'admin',reference:'manual_confirmed',createdAt:now()});await done(tx)}
function v522RecoveryModal(stored,finish,cancel){
  modal('استعادة رقم الإدارة من نسخة Backup',`<p class="summary-warn">اختار أحدث نسخة Backup JSON تخص الكاشير الحالي. هنقارن بصمة رقم الإدارة في الملف بالرقم المحفوظ على الجهاز. لن نعيد استيراد البيانات أو نمس أي فاتورة.</p><label class="form-label" for="v522PinBackup">ملف كاشير سدرة Backup JSON</label><input class="field" type="file" accept=".json,application/json" id="v522PinBackup">${field('v522RecoveryPin','رقم الإدارة الجديد — 4 أرقام أو أكثر','','password')}${field('v522RecoveryPin2','تأكيد الرقم الجديد','','password')}<button class="btn primary block" id="v522ConfirmRecovery">استعادة الرقم فقط</button><button class="btn outline block spaced" id="v522ReturnPin">رجوع لشاشة الدخول</button>`,cancel);
  $('#v522ReturnPin').onclick=()=>v522LoginModal(stored,finish,cancel);
  $('#v522ConfirmRecovery').onclick=async()=>{
    const file=$('#v522PinBackup').files?.[0],a=v522CleanPin($('#v522RecoveryPin').value),b=v522CleanPin($('#v522RecoveryPin2').value);
    if(!file)return toast('اختار نسخة Backup الأصلية أولًا');
    if(!/^\d{4,}$/.test(a)||a!==b)return toast('رقم الإدارة الجديد غير صالح أو غير متطابق');
    let backup;try{backup=JSON.parse(await file.text())}catch(e){return toast('الملف غير صالح، لازم يكون Backup JSON')}
    const recorded=backup?.stores?.settings?.find?.(x=>x.key==='adminPin')?.value;
    if(backup.app!=='sedra_pos_v5'||backup.sourceDb!==DB_NAME||typeof recorded!=='string'||recorded!==stored)return toast('الملف لا يطابق رقم إدارة قاعدة الكاشير الحالية');
    if(!confirm('تأكيد تغيير رقم الإدارة فقط؟ لن يتم استيراد أي صنف أو فاتورة من الملف.'))return;
    await saveSetting('adminPin',await sha(a));await v522AuditPin('admin_pin_recovered_from_matching_backup');adminSession=true;finish(true);toast('تم تحديث رقم الإدارة بدون لمس البيانات');
  };
}
function v522LoginModal(stored,finish,cancel){
  modal('صلاحية الإدارة',`${field('pinLogin','رقم الإدارة','','password')}<button class="btn primary block" id="checkPin">دخول</button><p class="hint">لو الرقم 0000 مش مقبول، فالرقم الحالي المسجل مختلف. تقدر تستعيده فقط باستخدام Backup صحيح من نفس الكاشير.</p><button class="btn outline block spaced" id="v522RecoverPin">استعادة رقم الإدارة من Backup</button>`,cancel);
  const login=async()=>{const current=v522CleanPin($('#pinLogin').value);if(await sha(current)!==stored)return toast('رقم الإدارة غير مطابق للرقم المحفوظ؛ استخدم استعادة Backup عند الحاجة');adminSession=true;finish(true)};
  $('#checkPin').onclick=login;$('#pinLogin').onkeydown=e=>{if(e.key==='Enter')login()};$('#v522RecoverPin').onclick=()=>v522RecoveryModal(stored,finish,cancel);
}
ensureAdmin=async function(){if(adminSession)return true;return new Promise(async resolve=>{
  let settled=false;const finish=ok=>{if(settled)return;settled=true;modalCancel=null;closeModal();resolve(ok)};
  const cancel=()=>{if(!settled){settled=true;resolve(false)}};
  try{const stored=await setting('adminPin');
    if(stored){v522LoginModal(stored,finish,cancel)}
    else{modal('تأسيس رقم الإدارة',`${field('pinA','PIN جديد — 4 أرقام على الأقل','','password')}${field('pinB','تأكيد PIN','','password')}<button class="btn primary block" id="savePin">حفظ الرقم</button>`,cancel);
      $('#savePin').onclick=async()=>{const a=v522CleanPin($('#pinA').value),b=v522CleanPin($('#pinB').value);if(!/^\d{4,}$/.test(a)||a!==b)return toast('رقم الإدارة غير صالح أو غير متطابق');await saveSetting('adminPin',await sha(a));await v522AuditPin('admin_pin_created');adminSession=true;finish(true)};}
  }catch(e){console.error(e);cancel();toast('تعذر فتح قفل الإدارة')}
})};
$('#adminChangePin').onclick=async()=>{if(!await ensureAdmin())return;
  modal('تغيير رقم الإدارة',`${field('v522NewPin','رقم جديد — 4 أرقام أو أكثر','','password')}${field('v522NewPinAgain','تأكيد الرقم','','password')}<button class="btn primary block" id="v522SaveNewPin">تغيير الرقم</button>`);
  $('#v522SaveNewPin').onclick=async()=>{const a=v522CleanPin($('#v522NewPin').value),b=v522CleanPin($('#v522NewPinAgain').value);if(!/^\d{4,}$/.test(a)||a!==b)return toast('الرقم الجديد غير صالح أو غير متطابق');if(!confirm('تأكيد تغيير رقم الإدارة على هذا الجهاز؟'))return;await saveSetting('adminPin',await sha(a));await v522AuditPin('admin_pin_changed');closeModal();toast('تم تغيير رقم الإدارة');};
};

/* 5. Customer statement now contains invoice line items as an appendix, preserving all payments. */
v52PrintStatement=async function(cid){
  try{
    const [customer,ledger,allInvoices,items]=await Promise.all([one('customers',cid),ledgerFor(cid),all('invoices'),all('items')]);
    if(!customer)throw Error('العميل غير موجود');
    const balance=balanceC(ledger),entries=ledger.slice().sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
    const invoiceList=allInvoices.filter(i=>i.customerId===cid&&i.creditC>0).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
    const pages=v52StatementDocumentPages(customer,entries,balance);
    for(const inv of invoiceList)pages.push(...v52InvoiceDocumentPages(inv,items.filter(it=>it.invoiceId===inv.id)));
    v52ShowDocPreview('كشف حساب تفصيلي + فواتير ('+invoiceList.length+') — PDF','Sedra_Statement_Detailed_'+customer.name.replace(/[\\/:*?"<>|]/g,'_')+'.pdf',pages);
  }catch(e){console.error(e);toast('تعذر تجهيز الكشف التفصيلي: '+e.message)}
};

/* Keep incoming tab in sync after recording a purchase or paying a supplier. */
const v522PriorRenderMore=renderMore;
renderMore=async function(){await v522PriorRenderMore();if(currentPage==='purchases')await v522RenderPurchases()};
