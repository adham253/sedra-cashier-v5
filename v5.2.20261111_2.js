'use strict';
/* Sedra V5.2: non-destructive, offline-safe feature upgrade. No user data is embedded here. */
const V52_BUILD='2026.11.11.2';
const V52_MIN_BULK_G=125;
const v52GrossLine=it=>Number.isFinite(it?.totalC)?it.totalC:0;
const v52KnownCost=it=>it&&it.costMissing!==true&&it.costEstimated!==true&&Number.isFinite(it.costTotalC)&&(it.costMissing===false||it.costTotalC>0);
const v52ItemCost=it=>v52KnownCost(it)?it.costTotalC:v52GrossLine(it);
const v52ReturnCost=(ret,it)=>v52KnownCost(it)&&it.qtyBase>0?Math.round(it.costTotalC*ret.qtyBase/it.qtyBase):ret.amountC;
const v52DateAdd=(dk,delta)=>{const d=new Date(dk+'T12:00:00');d.setDate(d.getDate()+delta);return day(d)};
const v52ValidDate=dk=>/^\d{4}-\d{2}-\d{2}$/.test(dk||'')&&!Number.isNaN(new Date(dk+'T12:00:00').valueOf());
const v52Period=(filter,start,end)=>{
  const today=day();
  if(filter==='all')return()=>true;
  if(filter==='today')return d=>d===today;
  if(filter==='yesterday')return d=>d===v52DateAdd(today,-1);
  if(filter==='week')return d=>d>=v52DateAdd(today,-6)&&d<=today;
  if(filter==='month')return d=>typeof d==='string'&&d.slice(0,7)===today.slice(0,7);
  if(filter==='date')return d=>d===start;
  if(filter==='range')return d=>d>=start&&d<=end;
  return()=>false;
};
async function v52SalesStats(filter='all',from='',to=''){
  const [invoices,items,returns]=await Promise.all(['invoices','items','returns'].map(all));
  const selected=v52Period(filter,from,to),selectedInv=invoices.filter(i=>selected(i.dateKey)),selectedIt=items.filter(i=>selected(i.dateKey)),selectedRet=returns.filter(r=>selected(r.dateKey));
  const map=new Map(items.map(it=>[it.id,it]));
  const invoiced=selectedInv.reduce((n,x)=>n+(x.totalC||0),0),refunded=selectedRet.reduce((n,x)=>n+(x.amountC||0),0);
  let knownCostC=0,provisionalCostC=0,returnedCostC=0,unknown=0,unmatchedReturn=0;
  for(const it of selectedIt){
    if(v52KnownCost(it))knownCostC+=it.costTotalC;
    else{unknown++;provisionalCostC+=v52GrossLine(it)}
  }
  for(const r of selectedRet){
    const it=map.get(r.itemId);
    if(!it)unmatchedReturn++;
    returnedCostC+=v52ReturnCost(r,it);
  }
  // Old invoice items without cost snapshots are intentionally *not* costed at today's price.
  // Some historical invoices may not have a complete item-level breakdown.
  const linesTotal=selectedIt.reduce((n,x)=>n+v52GrossLine(x),0),missingAmount=Math.max(0,invoiced-linesTotal);
  const netCostC=knownCostC+provisionalCostC+missingAmount-returnedCostC;
  return {selectedInv,items:selectedIt,returns:selectedRet,netSalesC:invoiced-refunded,netCostC,
    profitC:invoiced-refunded-netCostC,unknown,knownCostC,provisionalCostC,missingAmount,unmatchedReturn};
}
salesStats=v52SalesStats;

function v52SummaryForDate(dk,data){
  const inv=data.invoices.filter(x=>x.dateKey===dk),ret=data.returns.filter(x=>x.dateKey===dk),cash=data.cash.filter(x=>x.dateKey===dk);
  const gross=inv.reduce((s,x)=>s+(x.totalC||0),0),returns=ret.reduce((s,x)=>s+(x.amountC||0),0);
  return {dateKey:dk,count:inv.length,invoicedC:gross,returnedC:returns,netSalesC:gross-returns,
    saleCashC:inv.reduce((s,x)=>s+(x.cashC||0),0),saleCreditC:inv.reduce((s,x)=>s+(x.creditC||0),0),
    collectionsC:cash.filter(x=>x.type==='collection').reduce((s,x)=>s+(x.amountC||0),0),
    refundCashC:ret.reduce((s,x)=>s+(x.cashC||0),0),
    netCashC:cash.reduce((s,x)=>s+(x.amountC||0),0)};
}
function v52MoneyTiles(label,value){return `<div class="stat"><small>${esc(label)}</small><b>${money(value)}</b></div>`}
renderInvoices=async function(){
  const filter=$('#invoiceFilter').value;
  const from=$('#v52DateFrom')?.value||'',to=filter==='range'?$('#v52DateTo')?.value||'':from;
  if(['date','range'].includes(filter)&&(!v52ValidDate(from)||!v52ValidDate(to)||from>to)){
    $('#invoiceStats').innerHTML='<div class="summary-warn">اختار تاريخًا صحيحًا، وتأكد أن بداية الفترة قبل نهايتها.</div>';
    $('#invoiceList').innerHTML='';$('#v52Daily').innerHTML='';return;
  }
  const [stat,cash]=await Promise.all([v52SalesStats(filter,from,to),all('cash')]);
  const list=stat.selectedInv.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  const inPeriod=v52Period(filter,from,to);
  const scopedCash=cash.filter(x=>inPeriod(x.dateKey));
  const salesCash=stat.selectedInv.reduce((s,x)=>s+(x.cashC||0),0);
  const credit=stat.selectedInv.reduce((s,x)=>s+(x.creditC||0),0);
  const collected=scopedCash.filter(x=>x.type==='collection').reduce((s,x)=>s+(x.amountC||0),0);
  const netCash=scopedCash.reduce((s,x)=>s+(x.amountC||0),0);
  $('#invoiceStats').innerHTML=v52MoneyTiles('صافي المبيعات (كاش + آجل)',stat.netSalesC)+
    v52MoneyTiles('مبيعات كاش عند البيع',salesCash)+v52MoneyTiles('مبيعات آجل عند البيع',credit)+
    v52MoneyTiles('تحصيل آجل خلال الفترة',collected)+v52MoneyTiles('صافي حركة الخزنة',netCash)+
    `<div class="stat"><small>المكسب النظري المحسوب</small><b>${money(stat.profitC)}</b></div>`+
    `<div class="stat"><small>عدد الفواتير</small><b>${list.length}</b></div>`+
    v52MoneyTiles('مرتجعات الفترة',stat.returns.reduce((n,r)=>n+r.amountC,0))+
    (stat.unknown||stat.missingAmount||stat.unmatchedReturn?`<div class="summary-warn v52-full">⚠ توجد ${stat.unknown} سطور بدون تكلفة شراء تاريخية؛ مساهمتها في المكسب النظري = صفر (تكلفة حسابية مؤقتة تساوي صافي بيعها). لا يمكن اعتبار إجمالي المكسب ربحًا نهائيًا.${stat.unmatchedReturn?' ويوجد مرتجع يحتاج مراجعة.':''}</div>`:'');
  const full=await Promise.all(['invoices','returns'].map(all));
  const allDates=new Set([...full[0],...full[1],...cash].filter(x=>inPeriod(x.dateKey)).map(x=>x.dateKey));
  if(filter==='date'||filter==='yesterday'||filter==='today')allDates.add(filter==='date'?from:filter==='yesterday'?v52DateAdd(day(),-1):day());
  const byDay=[...allDates].sort().reverse().map(d=>v52SummaryForDate(d,{invoices:full[0],returns:full[1],cash}));
  $('#v52Daily').innerHTML=byDay.length?`<h3>مراجعة المبيعات يوم بيوم</h3><div class="v52-scroll"><table class="item-table v52-table"><thead><tr><th>اليوم</th><th>الفواتير</th><th>صافي المبيعات</th><th>مبيعات الآجل</th><th>تحصيل آجل</th><th>حركة الخزنة</th><th>Excel</th></tr></thead><tbody>${byDay.map(r=>`<tr><td>${esc(r.dateKey)}</td><td>${r.count}</td><td>${money(r.netSalesC)}</td><td>${money(r.saleCreditC)}</td><td>${money(r.collectionsC)}</td><td>${money(r.netCashC)}</td><td><button class="btn small outline" data-export-history="${esc(r.dateKey)}">تنزيل</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">لا توجد مبيعات أو مرتجعات في الفترة المختارة.</p>';
  $$('#v52Daily [data-export-history]').forEach(b=>b.onclick=()=>v52DownloadDay(b.dataset.exportHistory));
  $('#invoiceList').innerHTML=list.length?list.map(i=>`<div class="list-card tap" data-invoice="${esc(i.id)}"><div class="card-top"><strong>${esc(i.number)}</strong><b>${money(i.totalC)}</b></div><div class="card-meta">${dateShow(i.createdAt)} · كاش ${money(i.cashC||0)}${i.creditC?' · آجل '+money(i.creditC):''} ${i.customerName?' · '+esc(i.customerName):''}${i.discountC?' · خصم '+money(i.discountC):''}${i.returnC?' · مرتجع '+money(i.returnC):''}</div></div>`).join(''):'<div class="blank">لا توجد فواتير في الفترة. المرتجعات قد تظهر في الملخص اليومي.</div>';
  $$('#invoiceList [data-invoice]').forEach(el=>el.onclick=()=>invoiceDetails(el.dataset.invoice));
};
$('#invoiceFilter').innerHTML='<option value="today">اليوم</option><option value="yesterday">أمس</option><option value="week">آخر 7 أيام</option><option value="month">الشهر الحالي</option><option value="date">يوم محدد</option><option value="range">من تاريخ إلى تاريخ</option><option value="all">جميع الفواتير</option>';
$('#invoiceFilter').onchange=()=>{const f=$('#invoiceFilter').value;$('#v52Dates').hidden=!['date','range'].includes(f);$('#v52ToWrap').hidden=f!=='range';renderInvoices()};
$('#v52DateFrom').onchange=()=>renderInvoices();
$('#v52DateTo').onchange=()=>renderInvoices();
$('#refreshInvoices').onclick=()=>renderInvoices();
$('#v52DateFrom').value=day();$('#v52DateTo').value=day();

/* The official daily exporter replaces the V5.1 exporter (which used undefined allSaleItems on returns). */
const v52ExcelMoney=c=>Math.round(c)/100;
exportDaily=async function(dk,closing=null){
  if(!v52ValidDate(dk))throw Error('تاريخ تقرير غير صحيح');
  const [d,stats,products,purchases,payables,stock,history,customersList,allItems,allReturns]=await Promise.all([
    daily(dk),v52SalesStats('date',dk,dk),all('products'),all('purchases'),all('payables'),all('stock'),all('historical'),all('customers'),all('items'),all('returns')]);
  const s=daySummary(d),finance=await currentFinance(),name=new Map(products.map(p=>[p.id,p.name])),cust=new Map(customersList.map(c=>[c.id,c.name]));
  const rawItems=allItems.filter(x=>x.dateKey===dk),purs=purchases.filter(x=>x.dateKey===dk),rets=allReturns.filter(x=>x.dateKey===dk);
  const retByItem=new Map();for(const r of rets)retByItem.set(r.itemId,(retByItem.get(r.itemId)||0)+r.amountC);
  const totalRevenue=stats.netSalesC;
  const summary=[['كاشير سدرة V5.2 — تقرير يومية',dk],['حالة اليوم',closing?'مغلق':'مؤقت'],['عدد الفواتير',s.count],
    ['قيمة مبيعات الفواتير',v52ExcelMoney(s.invTotal)],['المرتجعات بتاريخ اليوم',v52ExcelMoney(s.returns)],['صافي المبيعات (كاش + آجل)',v52ExcelMoney(totalRevenue)],
    ['مبيعات كاش وقت البيع',v52ExcelMoney(s.saleCash)],['مبيعات آجل وقت البيع',v52ExcelMoney(s.saleCredit)],['تحصيل آجل اليوم',v52ExcelMoney(s.col)],
    ['صافي حركة الكاش (يشمل الوارد والمصروف)',v52ExcelMoney(s.netCash)],['المكسب النظري المحسوب — ليس ربحًا نهائيًا',v52ExcelMoney(stats.profitC)],
    ['عدد السطور بدون تكلفة تاريخية',stats.unknown],['قيمة بيع سطور مجهولة التكلفة',v52ExcelMoney(stats.provisionalCostC)],
    ['تنبيه','السطور بلا تكلفة شراء تاريخية مساهمتها صفر في المكسب النظري؛ تكلفة الشراء الحقيقية غير معروفة'],
    ['المفروض في الخزنة الآن',v52ExcelMoney(finance.cashExpectedC)],['مديونية العملاء الآن',v52ExcelMoney(finance.customerDebt)],
    ['مديونية الموردين الآن',v52ExcelMoney(finance.supplierDebt)],['قيمة مخزون مؤكدة جزئيًا',v52ExcelMoney(finance.stockCostC)],
    ['تقدير بديل لجزء المخزون المجهول بسعر بيعه',v52ExcelMoney(finance.stockCostEstimateC-finance.stockCostC)]];
  const invoices=[['رقم الفاتورة','التاريخ','صافي البيع','قبل الخصم','الخصم','سبب الخصم','كاش','آجل','مرتجع'],...d.invoices.map(x=>[x.number,x.createdAt,v52ExcelMoney(x.totalC),v52ExcelMoney(x.grossC??x.totalC),v52ExcelMoney(x.discountC||0),x.discountReason||'',v52ExcelMoney(x.cashC||0),v52ExcelMoney(x.creditC||0),v52ExcelMoney(x.returnC||0)])];
  const items=[['الفاتورة','الصنف','الكمية الأساسية','الوحدة','نوع بيع الوزن','السعر للوحدة','إجمالي السطر بعد الخصم','تكلفة تاريخية مؤكدة','التكلفة الحسابية للأرباح','تكلفة مفقودة','مرتجع اليوم','سبب تعديل السعر'],...rawItems.map(x=>[x.number,x.productName,x.qtyBase,x.kind==='weight'?'جرام':x.unit||'قطعة',x.kind==='weight'?(x.saleTier==='bulk'?'بيع كميات':x.saleTier==='regular'?'بيع عادي':'غير مصنف (قديم)'):'بالعدد',v52ExcelMoney(x.priceC||0),v52ExcelMoney(x.totalC||0),v52KnownCost(x)?v52ExcelMoney(x.costTotalC):'غير معروفة',v52ExcelMoney(v52ItemCost(x)),v52KnownCost(x)?'لا':'نعم',v52ExcelMoney(retByItem.get(x.id)||0),x.priceReason||''])];
  const totals=new Map();
  for(const it of allItems){if(it.dateKey!==dk)continue;const group=totals.get(it.productId)||{name:it.productName,kind:it.kind,regularQty:0,regularC:0,bulkQty:0,bulkC:0,legacyQty:0,legacyC:0};const bulk=it.kind==='weight'&&it.saleTier==='bulk';
    if(bulk){group.bulkQty+=it.qtyBase;group.bulkC+=it.totalC}else if(it.kind==='weight'&&it.saleTier!=='regular'){group.legacyQty+=it.qtyBase;group.legacyC+=it.totalC}else{group.regularQty+=it.qtyBase;group.regularC+=it.totalC}totals.set(it.productId,group)}
  // Returns issued today are shown independently, even if their invoice was sold on another day.
  const retQty=new Map();for(const r of rets){const x=retQty.get(r.productId)||{qty:0,value:0};x.qty+=r.qtyBase;x.value+=r.amountC;retQty.set(r.productId,x);if(!totals.has(r.productId)){const p=products.find(p=>p.id===r.productId);totals.set(r.productId,{name:r.productName||p?.name||r.productId,kind:p?.kind||"weight",regularQty:0,regularC:0,bulkQty:0,bulkC:0,legacyQty:0,legacyC:0})}}
  const productRows=[['الصنف','الوحدة','كمية بيع عادي','مبلغ بيع عادي بعد الخصم','كمية بيع كميات','مبلغ بيع كميات بعد الخصم','كمية بيع غير مصنف (فواتير قديمة)','مبلغ بيع غير مصنف (فواتير قديمة)','إجمالي الكمية المباعة','إجمالي المبيعات','كمية مرتجعة اليوم','قيمة المرتجعات اليوم','صافي المبيعات بعد المرتجعات'],...Array.from(totals.entries()).map(([id,x])=>{const r=retQty.get(id)||{qty:0,value:0};return[x.name,x.kind==='weight'?'جرام':'قطعة',x.regularQty,v52ExcelMoney(x.regularC),x.bulkQty,v52ExcelMoney(x.bulkC),x.legacyQty,v52ExcelMoney(x.legacyC),x.regularQty+x.bulkQty+x.legacyQty,v52ExcelMoney(x.regularC+x.bulkC+x.legacyC),r.qty,v52ExcelMoney(r.value),v52ExcelMoney(x.regularC+x.bulkC+x.legacyC-r.value)]})];
  // Monetary grand totals; quantities are not summed across grams and pieces.
  const finTotals=[...totals.values()].reduce((a,x)=>{a.regular+=x.regularC;a.bulk+=x.bulkC;a.legacy+=x.legacyC;return a},{regular:0,bulk:0,legacy:0});
  const refundTotal=rets.reduce((n,x)=>n+x.amountC,0);
  productRows.push(['الإجمالي المالي (لا تُجمع الجرامات مع القطع)','', '',v52ExcelMoney(finTotals.regular),'',v52ExcelMoney(finTotals.bulk),'',v52ExcelMoney(finTotals.legacy),'',v52ExcelMoney(finTotals.regular+finTotals.bulk+finTotals.legacy),'',v52ExcelMoney(refundTotal),v52ExcelMoney(finTotals.regular+finTotals.bulk+finTotals.legacy-refundTotal)]);
  const retReport=[['التاريخ','رقم الفاتورة الأصلية','الصنف','كمية مرتجعة','قيمة المرتجع','رد نقدي','خصم من الآجل'],...rets.map(r=>[r.createdAt,r.invoiceNumber,r.productName,r.qtyBase,v52ExcelMoney(r.amountC),v52ExcelMoney(r.cashC||0),v52ExcelMoney(r.creditC||0)])];
  const income=[['رقم الوارد','التاريخ','المورد','الصنف','الوحدة','الكمية','الكمية الأساسية','تكلفة الوحدة','قيمة السطر','مدفوع للوارد'],...purs.flatMap(p=>(p.rows||[]).map(r=>[p.number,p.createdAt,p.supplier||'',r.productName,r.unitName,r.qty,r.qtyBase,v52ExcelMoney(r.unitCostC),v52ExcelMoney(r.totalC),v52ExcelMoney(p.paidC)]))];
  const suppliers=[['التاريخ','المورد','نوع الحركة','المرجع','زيادة/نقص المديونية'],...payables.filter(x=>x.dateKey===dk).map(x=>[x.createdAt,x.supplier,x.type,x.reference,v52ExcelMoney(x.amountC)])];
  const cash=[['التاريخ','نوع الحركة','المرجع','داخل/خارج'],...d.cash.map(x=>[x.createdAt,x.type,x.reference,v52ExcelMoney(x.amountC)])];
  const stockSheet=[['التاريخ','الصنف','نوع الحركة','الكمية الأساسية (+/-)','المرجع'],...stock.filter(x=>x.dateKey===dk).map(x=>[x.createdAt,name.get(x.productId)||x.productId,x.type,x.qtyBase,x.reference])];
  const ledger=[['التاريخ','العميل','نوع الحركة','تغير المديونية'],...d.ledger.map(x=>[x.createdAt,cust.get(x.customerId)||x.customerId,x.type,v52ExcelMoney(x.amountC)])];
  const old=[['التاريخ','القيمة','النوع','التفاصيل','الحالة'],...history.filter(x=>x.dateKey===dk).map(x=>[x.dateKey,v52ExcelMoney(x.amountC),x.type,x.note,x.status||'active'])];
  downloadBlob(`Sedra_V52_Daily_${dk}.xlsx`,makeXlsx([{name:'الملخص',rows:summary},{name:'فواتير البيع',rows:invoices},{name:'ملخص بيع الأصناف',rows:productRows},{name:'سطور البيع',rows:items},{name:'المرتجعات',rows:retReport},{name:'فواتير الوارد',rows:income},{name:'ديون الموردين',rows:suppliers},{name:'الخزنة والمصروفات',rows:cash},{name:'حركة المخزون',rows:stockSheet},{name:'مديونيات العملاء',rows:ledger},{name:'مبيعات قديمة',rows:old}]));
  return true;
};
async function v52DownloadDay(dk){try{await exportDaily(dk,await one('closings',dk));toast('تم تجهيز تقرير '+dk)}catch(e){console.error(e);toast('تعذر إنشاء Excel: '+e.message)}}
$('#exportDay').onclick=()=>v52DownloadDay(day());
// Closing must be saved even when file sharing/downloading fails; allow retry.
const v52OldCloseDay=$('#closeDay').onclick;
$('#closeDay').onclick=async()=>{
  await v52OldCloseDay();
  const confirmBtn=$('#confirmClose');if(!confirmBtn)return;
  const old=confirmBtn.onclick;
  confirmBtn.onclick=async()=>{
    const originalExporter=exportDaily;
    let failMsg='';
    exportDaily=async(...args)=>{try{return await originalExporter(...args)}catch(e){failMsg=e.message;console.error(e);return false}};
    try{await old();if(failMsg)toast('اليوم اتقفل، لكن Excel فشل: نزله لاحقًا من الفواتير')}finally{exportDaily=originalExporter}
  };
};

/* Pricing: one shared inventory; the two prices are two invoice lines with a tier tag. */
const v52BulkEnabled=p=>isWeight(p)&&Number.isInteger(p.bulkPriceC)&&p.bulkPriceC>0;
const v52CartKey=(id,tier='regular')=>tier==='bulk'?`${id}::bulk`:id;
const v52FindEntry=key=>cart.get(key);
const v52QtyRound=q=>Math.round(q*100)/100;
function v52UpdateCartLine(root,key){
  const x=v52FindEntry(key);if(!x||!root)return;
  root.querySelector('.item-head>b').textContent=money(lineC(x.p,x.qty,x));
  const note=root.querySelector('[data-v52-info]');if(note){note.textContent=x.invalid?'⚠ راجع المبلغ أو الوزن':`${qtyShown(x)} · قيمة البيع ${money(lineC(x.p,x.qty,x))}`;note.classList.toggle('redtxt',x.invalid)}
  const warn=root.querySelector('[data-v52-stock]');if(warn)warn.textContent=x.p.stockQty-x.qty<0?'⚠ المخزون الدفتري سيصبح بالسالب':' ';
  updateTotals();
}
addProductToCart=async function(id,tier='regular'){
  const p=await one('products',id);if(!p||p.active===false)return toast('الصنف غير متاح للبيع');
  if(!(p.priceC>0))return toast('سعر البيع غير محدد');
  if(tier==='bulk'&&!v52BulkEnabled(p))return toast('سعر الكميات غير مسجل لهذا الصنف');
  const key=v52CartKey(id,tier),w=isWeight(p);
  const x=cart.get(key)||{p,qty:w?(tier==='bulk'?V52_MIN_BULK_G:0):0,unit:w?'g':'count',mode:w?(tier==='bulk'?'qty':'money'):'qty',amountC:null,overridePriceC:null,priceReason:'',saleTier:tier,expanded:true,invalid:false};
  x.p=p;x.saleTier=tier;x.expanded=true;
  if(!w){x.qty++;if(x.mode==='money')x.amountC=x.qty*priceOf(x)}
  cart.set(key,x);$('#searchInput').value='';$('#searchResults').innerHTML='';renderCart();
  if(w){const el=document.querySelector(`[data-v52-money="${CSS.escape(key)}"], [data-v52-weight="${CSS.escape(key)}"]`);el?.focus()}
};
cartValid=function(){
  const dis=discountC(),total=cartTotal();
  return cart.size>0&&[...cart.values()].every(x=>{
    const price=priceOf(x),raw=lineC(x.p,x.qty,x);
    return !x.invalid&&Number.isFinite(x.qty)&&x.qty>0&&(isWeight(x.p)||Number.isInteger(x.qty))&&
      !(x.saleTier==='bulk'&&x.qty<V52_MIN_BULK_G)&&price>0&&Number.isSafeInteger(raw)&&raw>0;
  })&&Number.isSafeInteger(dis)&&dis>=0&&dis<=total&&total-dis>0;
};
priceEditDialog=function(key){
  const x=v52FindEntry(key);if(!x)return;
  const old=priceOf(x);
  modal('سعر بيع خاص لهذه الفاتورة',`<p class="help">${esc(x.p.name)} · سعر هذا النوع من البيع ${money(old)} / ${isWeight(x.p)?'كيلو':esc(x.p.unit)}. لا تتغير أسعار المخزون أو الشراء.</p>${field('specialPrice','سعر البيع الخاص للوحدة','', 'number',moneyRaw(old))}${field('priceReason','سبب تغيير السعر (اختياري)','فصال / خصم خاص','text',x.priceReason||'')}<button class="btn primary block spaced" id="approvePrice">اعتماد السعر لهذه الفاتورة</button>`);
  $('#approvePrice').onclick=()=>{
    const v=num($('#specialPrice').value);if(!(v>0)||!Number.isSafeInteger(cents(v)))return toast('سعر غير صحيح');
    const next=cents(v);if(!confirm(`تأكيد سعر ${money(next)} لهذه الفاتورة فقط؟`))return;
    x.overridePriceC=next;x.priceReason=$('#priceReason').value.trim();
    if(x.mode==='money'&&x.amountC>0){if(isWeight(x.p))x.qty=v52QtyRound(x.amountC*1000/next);else{x.qty=x.amountC/next;x.invalid=!Number.isInteger(x.qty)}}
    if(x.saleTier==='bulk'&&x.qty<V52_MIN_BULK_G)x.invalid=true;
    closeModal();renderCart();
  };
};
renderCart=function(){
  const box=$('#cartItems');$('#cartCount').textContent=cart.size+' أصناف';
  if(!cart.size){box.innerHTML='<div class="blank">اختار أول صنف عشان تبدأ الفاتورة</div>';updateTotals();return}
  box.innerHTML=[...cart.entries()].map(([key,x])=>{
    const p=x.p,w=isWeight(p),bulk=x.saleTier==='bulk',open=x.expanded!==false,rate=priceOf(x),custom=Number.isInteger(x.overridePriceC),canBulk=v52BulkEnabled(p);
    const selector=`<div class="mode-controls"><button class="btn ${x.mode==='money'?'primary':'outline'}" data-v52-mode="money" data-key="${esc(key)}">بالفلوس (ج)</button><button class="btn ${x.mode==='qty'?'primary':'outline'}" data-v52-mode="qty" data-key="${esc(key)}">${w?'بالوزن':'بالعدد'}</button></div>`;
    const moneyField=`<label class="form-label">العميل طلب بكام؟</label><input class="field" data-v52-money="${esc(key)}" inputmode="decimal" type="number" step="0.01" min="0" value="${x.amountC>0?moneyRaw(x.amountC):''}" placeholder="المبلغ بالجنيه">`;
    const qtyField=w?`<div class="qty-row"><input class="unit-input" data-v52-weight="${esc(key)}" inputmode="decimal" type="number" step="any" min="0" placeholder="الوزن" value="${x.qty>0?(x.unit==='kg'?fmt(x.qty/1000):fmt(x.qty)):''}"><div class="weight-tabs"><button data-v52-unit="g" data-key="${esc(key)}" class="${x.unit==='g'?'active':''}">جرام</button><button data-v52-unit="kg" data-key="${esc(key)}" class="${x.unit==='kg'?'active':''}">كيلو</button></div></div>`:
      `<div class="qty-row"><div class="qty-tools"><button class="round" data-v52-adjust="-1" data-key="${esc(key)}">−</button><span class="count-value">${fmt(x.qty)}</span><button class="round" data-v52-adjust="1" data-key="${esc(key)}">+</button></div></div>`;
    const bulkButtons=bulk&&x.mode==='qty'?`<div class="v52-shortcuts">${[125,250,500,1000].map(g=>`<button class="btn small outline" data-v52-grams="${g}" data-key="${esc(key)}">${g===1000?'كيلو':g+' جرام'}</button>`).join('')}</div>`:'';
    const tierAction=w&&canBulk?`<div class="v52-tier"><span class="chip">${bulk?'سعر الكميات — من 125 جرام':'السعر العادي — الافتراضي'}</span><button class="btn small outline" data-v52-tier="${bulk?'regular':'bulk'}" data-id="${esc(p.id)}">${bulk?'بيع عادي أيضًا':'بيع كمية (تُمن / ربع)'}</button></div>`:'';
    const label=bulk?' <span class="badge amber">بيع كميات</span>':'';
    return `<div class="cart-line ${open?'':'compact'}" data-cartline="${esc(key)}"><div class="item-head"><div style="flex:1;min-width:0"><div class="item-name">${esc(p.name)}${label}</div><small>${esc(qtyShown(x))} · ${money(rate)} / ${esc(w?'كيلو':p.unit)}</small>${custom?'<div class="price-note">سعر خاص لهذه الفاتورة</div>':''}</div><b>${money(lineC(p,x.qty,x))}</b><div class="cart-actions">${open?`<button class="mini-icon confirm" data-v52-ok="${esc(key)}">✓</button>`:`<button class="mini-icon" data-v52-edit="${esc(key)}">✎</button>`}<button class="mini-icon delete" data-v52-remove="${esc(key)}">×</button></div></div>${open?`<div class="cart-expand">${tierAction}${selector}${x.mode==='money'?moneyField:qtyField}${bulkButtons}<div class="status-line ${x.invalid?'redtxt':''}" data-v52-info="${esc(key)}">${x.invalid?'⚠ راجع المبلغ أو الوزن':esc(qtyShown(x))}</div>${bulk?'<p class="hint">سعر الكميات متاح من 125 جرام. نفس مخزون الصنف العادي.</p>':''}<span class="status-line redtxt" data-v52-stock>${p.stockQty-x.qty<0?'⚠ المخزون الدفتري سيصبح بالسالب':''}</span><button class="btn small outline" data-v52-price="${esc(key)}">تعديل سعر البيع للفاتورة فقط ✎</button></div>`:''}</div>`;
  }).join('');
  box.querySelectorAll('[data-v52-ok]').forEach(b=>b.onclick=()=>{const x=v52FindEntry(b.dataset.v52Ok);if(!x||!cartValid()&&(!x.qty||x.invalid||x.saleTier==='bulk'&&x.qty<V52_MIN_BULK_G))return toast('راجع الكمية أو المبلغ الأول');x.expanded=false;renderCart();focusNextSell()});
  box.querySelectorAll('[data-v52-edit]').forEach(b=>b.onclick=()=>{v52FindEntry(b.dataset.v52Edit).expanded=true;renderCart()});
  box.querySelectorAll('[data-v52-remove]').forEach(b=>b.onclick=()=>{cart.delete(b.dataset.v52Remove);renderCart()});
  box.querySelectorAll('[data-v52-mode]').forEach(b=>b.onclick=()=>{
    const x=v52FindEntry(b.dataset.key),next=b.dataset.v52Mode;if(x.mode===next)return;
    if(next==='money'){x.amountC=x.qty>0?lineC(x.p,x.qty,x):null}
    else{x.amountC=null}
    x.mode=next;x.invalid=false;renderCart();
  });
  box.querySelectorAll('[data-v52-tier]').forEach(b=>b.onclick=()=>addProductToCart(b.dataset.id,b.dataset.v52Tier));
  box.querySelectorAll('[data-v52-price]').forEach(b=>b.onclick=()=>priceEditDialog(b.dataset.v52Price));
  box.querySelectorAll('[data-v52-unit]').forEach(b=>b.onclick=()=>{v52FindEntry(b.dataset.key).unit=b.dataset.v52Unit;renderCart()});
  box.querySelectorAll('[data-v52-adjust]').forEach(b=>b.onclick=()=>{const x=v52FindEntry(b.dataset.key);x.qty=Math.max(1,x.qty+Number(b.dataset.v52Adjust));renderCart()});
  box.querySelectorAll('[data-v52-grams]').forEach(b=>b.onclick=()=>{const x=v52FindEntry(b.dataset.key);x.qty=Number(b.dataset.v52Grams);x.unit='g';x.amountC=null;x.invalid=false;renderCart()});
  box.querySelectorAll('[data-v52-weight]').forEach(inp=>inp.oninput=()=>{
    const x=v52FindEntry(inp.dataset.v52Weight),v=num(inp.value),g=x.unit==='kg'?v*1000:v;
    x.qty=Number.isFinite(g)&&g>0?v52QtyRound(g):0;
    x.invalid=x.saleTier==='bulk'&&x.qty<V52_MIN_BULK_G;v52UpdateCartLine(inp.closest('.cart-line'),inp.dataset.v52Weight);
  });
  box.querySelectorAll('[data-v52-money]').forEach(inp=>inp.oninput=()=>{
    const key=inp.dataset.v52Money,x=v52FindEntry(key),v=num(inp.value),amt=cents(v),rate=priceOf(x);
    let ok=Number.isFinite(v)&&v>0&&Number.isSafeInteger(amt)&&amt>0&&rate>0;
    if(ok){if(isWeight(x.p)){x.qty=v52QtyRound(amt*1000/rate);ok=x.qty>0}else{const q=amt/rate;ok=Number.isInteger(q)&&q>0;if(ok)x.qty=q}}
    x.amountC=ok?amt:0;if(!ok)x.qty=0;
    x.invalid=!ok||(x.saleTier==='bulk'&&x.qty<V52_MIN_BULK_G);
    v52UpdateCartLine(inp.closest('.cart-line'),key);
  });
  updateTotals();
};

/* Fast product creation; no guessed initial stock, and verify duplicates before saving. */
showNewProduct=function(barcode='',fromSell=false){
  const searchText=fromSell?$('#searchInput').value.trim():'';
  modal('إضافة صنف جديد',`${field('npName','اسم الصنف *','','text',searchText)}${field('npPrice','سعر بيع الوحدة (للموزون: سعر الكيلو)','', 'number')}<label class="form-label">الوحدة</label><select id="npUnit" class="field">${options(['قطعة','زجاجة','كيس','علبة','عبوة','شرينك','كرتونة','كيلو','باكو','لفة','ربطة'].map(u=>[u,u]))}</select>${field('npCost','تكلفة الشراء للوحدة (اختياري) — للموزون سعر الكيلو','', 'number')}${field('npBulk','سعر بيع كيلو الكميات من 125 جرام (اختياري)','', 'number')}${field('npBarcode','الباركود (اختياري)','', 'text',barcode)}<p class="hint">سعر الكميات يشتغل على الأصناف الموزونة فقط. رصيد الصنف يبدأ صفرًا «غير مجرود» حتى تسجيل وارد أو جرد، ولا نختلق مخزونًا.</p><button class="btn primary block" id="npSave">حفظ الصنف${fromSell?' وإضافته للفاتورة':''}</button>`);
  $('#npSave').onclick=async()=>{
    const name=$('#npName').value.trim(),v=num($('#npPrice').value),unit=$('#npUnit').value,barcode=$('#npBarcode').value.trim(),costText=$('#npCost').value.trim(),bulkText=$('#npBulk').value.trim();
    const cost=costText===''?null:num(costText),bulk=bulkText===''?null:num(bulkText);
    if(name.length<2||!(v>0)||!Number.isSafeInteger(cents(v)))return toast('راجع الاسم وسعر البيع');
    if(cost!==null&&(!Number.isFinite(cost)||cost<0))return toast('تكلفة الشراء غير صحيحة');
    if(bulk!==null&&(unit!=='كيلو'||!(bulk>0)))return toast('سعر الكميات متاح للأصناف الموزونة فقط');
    const ps=await all('products');if(ps.some(p=>norm(p.name)===norm(name)&&p.active!==false))return toast('اسم الصنف موجود بالفعل — ابحث عنه بدل تكراره');
    if(barcode&&ps.some(p=>p.barcode===barcode&&p.active!==false))return toast('الباركود مستخدم لصنف آخر');
    const nums=ps.map(x=>/^SC(\d+)$/.exec(x.code||'')).filter(Boolean).map(x=>+x[1]);
    const code=barcode||'SC'+String(Math.max(0,...nums)+1).padStart(4,'0'),id=uid('P'),at=now();
    const p={id,code,name,priceC:cents(v),unit,kind:unit==='كيلو'?'weight':'count',barcode,active:true,stockInitialized:false,stockStatus:'unverified',stockQty:0,lowStockBase:unit==='كيلو'?500:5,packages:[],createdAt:at,source:'cashier-v5.2',costUnknown:cost===null};
    if(cost!==null)p.costBaseC=unit==='كيلو'?cents(cost)/1000:cents(cost);
    if(bulk!==null)p.bulkPriceC=cents(bulk);
    await put('products',p);closeModal();toast('تم حفظ الصنف — الكمية تحتاج جردًا');
    renderProducts();refreshSaleWarnings();
    if(fromSell)await addProductToCart(id);
  };
};
$('#quickAddSell').onclick=()=>showNewProduct('',true);

/* Price administration distinguishes manual cost correction from *actual* incoming stock. */
openProductAdmin=async function(id){
  const p=await one('products',id);if(!p)return;
  const costBase=priceForBase(p),costUnit=costBase===null?'':moneyRaw(costBase*(isWeight(p)?1000:1));
  modal('تعديل الصنف والأسعار — إدارة',`<p><b>${esc(p.name)}</b></p>${field('editName','اسم الصنف','','text',p.name)}${field('editPrice','سعر البيع (للموزون الكيلو)','','number',moneyRaw(p.priceC))}${field('editCost','تكلفة شراء المخزون المتبقي (تصحيح فقط)','','number',costUnit)}${isWeight(p)?field('editBulk','سعر كيلو الكميات من 125 جرام (اتركه فارغًا للإلغاء)','','number',p.bulkPriceC?moneyRaw(p.bulkPriceC):''):''}${field('editBarcode','الباركود','','text',p.barcode||'')}${field('editLimit',isWeight(p)?'حد التنبيه (جرام)':'حد التنبيه (وحدات)','','number',p.lowStockBase)}${isWeight(p)?`<label class="form-label">وحدة عرض الوزن</label><select id="editPreferred" class="field">${options([['g','جرام'],['kg','كيلو']],p.preferredWeightUnit||'g')}</select>`:''}<p class="summary-warn">تعديل تكلفة الشراء هنا تصحيح لتكلفة المخزون المتبقي فقط ولا يضيف بضاعة، ولا يغير أرباح الفواتير القديمة. عند شراء بضاعة بسعر جديد استخدم «فاتورة وارد» ليُحسب متوسط التكلفة تلقائيًا.</p><label class="form-label"><input type="checkbox" id="editVerifyCost"> اعتماد تكلفة الشراء الحالية للمخزون بعد مراجعتها (حتى لو نفس الرقم)</label>${field('editReason','سبب تعديل تكلفة الشراء (مطلوب عند تغييرها)','','text')}<button id="saveProductAdmin" class="btn primary block">حفظ التعديلات</button>`);
  $('#saveProductAdmin').onclick=async()=>{
    const price=num($('#editPrice').value),costText=$('#editCost').value.trim(),cost=costText===''?null:num(costText),bulkText=$('#editBulk')?.value.trim()||'',bulk=bulkText===''?null:num(bulkText),limit=num($('#editLimit').value),name=$('#editName').value.trim(),barcode=$('#editBarcode').value.trim(),reason=$('#editReason').value.trim();
    if(!(price>0)||!Number.isSafeInteger(cents(price))||name.length<2||!Number.isFinite(limit)||limit<0||!isWeight(p)&&!Number.isInteger(limit))return toast('راجع بيانات الصنف');
    if(cost!==null&&(!Number.isFinite(cost)||cost<0))return toast('تكلفة الشراء غير صحيحة');
    if(bulk!==null&&!(bulk>0))return toast('سعر الكميات غير صحيح');
    const previousCost=priceForBase(p),newCost=cost===null?null:cents(cost)/(isWeight(p)?1000:1);
    const verified=$('#editVerifyCost')?.checked===true;if(verified&&newCost===null)return toast('لازم تكتب تكلفة شراء قبل اعتمادها');
    const changed=(previousCost===null)!==(newCost===null)||(previousCost!==null&&newCost!==null&&Math.abs(previousCost-newCost)>0.000001)||(verified&&p.costEstimateDueToLegacyStock);
    if(changed&&!reason)return toast('اكتب سبب تصحيح تكلفة الشراء');
    const ps=await all('products');if(ps.some(x=>x.id!==p.id&&x.active!==false&&(norm(x.name)===norm(name)||barcode&&x.barcode===barcode)))return toast('هناك صنف آخر بنفس الاسم أو الباركود');
    if(changed&&!confirm('تصحيح سعر شراء المخزون المتبقي فقط — بدون إضافة وارد وبدون تغيير الفواتير السابقة. تأكيد؟'))return;
    const previousPrice=p.priceC,prevBulk=p.bulkPriceC??null;
    p.name=name;p.priceC=cents(price);p.barcode=barcode;p.lowStockBase=limit;if(isWeight(p))p.preferredWeightUnit=$('#editPreferred').value;
    if(isWeight(p)){if(bulk===null)delete p.bulkPriceC;else p.bulkPriceC=cents(bulk)}
    if(changed){p.costEstimateDueToLegacyStock=false;p.costUnknown=cost===null;if(cost===null){delete p.costBaseC}else p.costBaseC=newCost}
    p.updatedAt=now();
    const tx=db.transaction(['products','audit'],'readwrite');tx.objectStore('products').put(p);
    tx.objectStore('audit').add({id:uid('AU'),action:'product_price_correction',reference:p.id,actor:'admin',createdAt:now(),previousPriceC:previousPrice,newPriceC:p.priceC,previousCostBaseC:previousCost,newCostBaseC:newCost,previousBulkC:prevBulk,newBulkC:p.bulkPriceC??null,reason});
    await done(tx);closeModal();toast('تم حفظ الأسعار بدون تغيير الفواتير السابقة');renderProducts();refreshSaleWarnings();searchRender();
  };
};

/* Financial snapshot separates known purchase cost from sale-price proxy for missing costs. */
currentFinance=async function(){
  const [ps,cash,payables,ledger,purchases]=await Promise.all(['products','cash','payables','ledger','purchases'].map(all));
  let stockCostC=0,stockSaleC=0,unknown=0,stockNegative=0,unknownStockProxyC=0;
  for(const p of ps){if(p.active===false)continue;
    const qty=Math.max(0,Number(p.stockQty)||0),salesValue=isWeight(p)?Math.round(qty*p.priceC/1000):Math.round(qty*p.priceC);
    stockSaleC+=salesValue;const cost=p.costEstimateDueToLegacyStock?null:priceForBase(p);
    if(cost===null){if(qty>0){unknown++;unknownStockProxyC+=salesValue}}
    else stockCostC+=Math.round(qty*cost);
    if(Number(p.stockQty)<0)stockNegative++;
  }
  const opening=await setting('openingCashC',650000),movement=cash.reduce((s,x)=>s+(x.amountC||0),0),supplierDebt=payables.reduce((s,x)=>s+(x.amountC||0),0),customerDebt=ledger.reduce((s,x)=>s+(x.amountC||0),0),expenses=cash.filter(x=>x.type==='expense'),paidToSupplier=cash.filter(x=>['purchase_payment','supplier_settlement','supplier'].includes(x.type)).reduce((s,x)=>s-x.amountC,0);
  return {stockCostC,stockSaleC,stockCostEstimateC:stockCostC+unknownStockProxyC,unknownStockProxyC,unknown,stockNegative,opening,movement,cashExpectedC:opening+movement,supplierDebt,customerDebt,expenses,paidToSupplier,purchases};
};
summaryRender=async function(){
  if(!db)return;const s=await currentFinance(),el=$('#businessSummary');if(!el)return;
  el.innerHTML=`<div class="stat dashboard-tile"><small>مخزون بتكلفة شراء معروفة</small><b>${money(s.stockCostC)}</b></div>`+
    `<div class="stat dashboard-tile"><small>تقدير مؤقت للإجمالي (المجهول بسعر بيعه)</small><b>${money(s.stockCostEstimateC)}</b></div>`+
    `<div class="stat dashboard-tile"><small>قيمة المخزون بسعر البيع</small><b>${money(s.stockSaleC)}</b></div>`+
    `<div class="stat dashboard-tile"><small>المفروض كاش في الخزنة</small><b>${money(s.cashExpectedC)}</b></div>`+
    `<div class="stat dashboard-tile"><small>مديونيات الموردين</small><b class="amber">${money(s.supplierDebt)}</b></div>`+
    `<div class="stat dashboard-tile"><small>مديونيات العملاء</small><b>${money(s.customerDebt)}</b></div>`+
    `<div class="stat dashboard-tile"><small>المدفوع للموردين</small><b>${money(s.paidToSupplier)}</b></div>`;
  $('#businessSummaryWarnings').innerHTML=`<span class="notice-small">رصيد الكاش الافتتاحي ${money(s.opening)} · صافي الحركات المسجلة ${money(s.movement)}.</span>`+
    (s.unknown?`<div class="summary-warn">⚠ ${s.unknown} صنف بالمخزون سعر شرائه مجهول. التقدير المؤقت يستبدل تكلفة شراء هذه الكمية بقيمة بيعها، وليس تقييم تكلفة فعليًا. الفرق بين الإجماليين لا يمثل ربحًا مؤكدًا.</div>`:'')+
    (s.stockNegative?`<div class="summary-warn">⚠ ${s.stockNegative} صنف رصيده سالب؛ مستبعد من التقييم حتى تسوية الجرد.</div>`:'')+
    '<p class="hint">المخزون أصل تجاري لا يساوي الكاش. لا تُجمع هذه القيم للحصول على رصيد الخزنة.</p>';
  const sup=await supplierBalances();$('#supplierAccounts').innerHTML=sup.length?sup.slice(0,12).map(x=>`<div class="list-card split"><span>${esc(x.supplier)}</span><b class="amber">${money(x.amountC)}</b></div>`).join(''):'<div class="hint">لا توجد مديونيات موردين مسجلة.</div>';
  $('#recentPurchases').innerHTML=s.purchases.length?`<h3 style="margin:15px 0 8px;font-size:13px">آخر فواتير الوارد</h3>`+s.purchases.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,7).map(x=>`<div class="list-card"><div class="card-top"><b>${esc(x.number)}</b><b>${money(x.totalC)}</b></div><div class="card-meta">${esc(x.supplier||'مورد غير محدد')} · ${x.rows?.length||0} صنف · مدفوع ${money(x.paidC)} · آجل ${money(x.dueC)}</div></div>`).join(''):'';
  $('#expenseLog').innerHTML=s.expenses.length?`<p class="hint">مصروفات مسجلة: ${money(-s.expenses.reduce((n,x)=>n+x.amountC,0))}</p>`+s.expenses.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,5).map(x=>`<div class="list-card split"><span>${esc(x.reference)}</span><b>${money(-x.amountC)}</b></div>`).join(''):'<div class="hint">لا توجد مصروفات مسجلة.</div>';
};

/* Credit invoice PDF uses browser's Save as PDF/Print; PNG is generated offline in a canvas. */
function v52CreditHtml(inv,items){
  const rows=items.map(it=>`<tr><td>${esc(it.productName)}</td><td>${esc(displayQty({kind:it.kind,unit:it.unit},it.qtyBase))}</td><td>${money(it.totalC||0)}</td></tr>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(inv.number)} · سدرة</title><style>body{margin:0;padding:28px;font-family:Tahoma,Arial,sans-serif;color:#1f3026;background:#fff;max-width:800px;margin:auto}h1{text-align:center;color:#12683a}p{text-align:center}table{border-collapse:collapse;width:100%;margin:22px 0}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:right}th{background:#eaf4ed}section{display:flex;justify-content:space-between;gap:16px;margin:10px 0;padding:9px;border-bottom:1px solid #e0e9e3}strong{color:#124e2b}.hint{font-size:12px;color:#666}.toolbar{padding:12px;background:#eaf4ed;text-align:center;margin-bottom:18px}.toolbar button{padding:12px 20px;background:#166a3b;border:0;color:white;font-weight:700;border-radius:8px}@media print{@page{size:A4;margin:16mm}.toolbar{display:none}body{padding:0}}</style></head><body><div class="toolbar">اضغط «طباعة / حفظ PDF»، ثم اختر «حفظ كملف PDF» من قائمة الطابعات <button onclick="window.print()">طباعة / حفظ PDF</button></div><h1>سدرة</h1><p>فاتورة مبيعات آجل</p><section><span>رقم الفاتورة</span><strong>${esc(inv.number)}</strong></section><section><span>التاريخ</span><b>${esc(dateShow(inv.createdAt))}</b></section><section><span>العميل</span><b>${esc(inv.customerName||'غير محدد')}</b></section><table><thead><tr><th>الصنف</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>${rows}</tbody></table><section><span>الإجمالي قبل خصم الفاتورة</span><b>${money(inv.grossC??inv.totalC)}</b></section><section><span>خصم الفاتورة</span><b>${money(inv.discountC||0)}</b></section><section><strong>الإجمالي المطلوب</strong><strong>${money(inv.totalC)}</strong></section><section><span>المدفوع وقت البيع</span><b>${money(inv.cashC||0)}</b></section><section><strong>الآجل عند إصدار الفاتورة</strong><strong>${money(inv.creditC||0)}</strong></section><p class="hint">المدفوعات اللاحقة تخص حساب العميل العام، ولا يتم خصمها من الفاتورة التاريخية تلقائيًا. راجع كشف الحساب للرصيد الحالي.</p></body></html>`;
}
async function v52PrintCredit(id){
  // Create popup immediately inside user click to prevent popup blocking.
  const w=window.open('','_blank');if(!w){toast('السماح بفتح نافذة الطباعة مطلوب لحفظ PDF');return}
  try{const inv=await one('invoices',id),items=(await all('items')).filter(x=>x.invoiceId===id);if(!inv)throw Error('الفاتورة غير موجودة');w.document.open();w.document.write(v52CreditHtml(inv,items));w.document.close()}catch(e){w.close();toast('تعذر تجهيز PDF: '+e.message)}
}
async function v52PngInvoice(id){
  const inv=await one('invoices',id);if(!inv)return toast('الفاتورة غير موجودة');
  const its=(await all('items')).filter(x=>x.invoiceId===id);
  const width=1080,pad=58,lineHeight=50,height=790+its.length*lineHeight;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)return toast('تصدير PNG غير مدعوم في المتصفح');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.textAlign='right';ctx.direction='rtl';
  ctx.fillStyle='#175f36';ctx.font='bold 58px Tahoma, Arial, sans-serif';ctx.fillText('سدرة',width-pad,110);
  ctx.fillStyle='#263c2e';ctx.font='bold 32px Tahoma, Arial, sans-serif';ctx.fillText('فاتورة آجل',width-pad,170);
  ctx.font='24px Tahoma, Arial, sans-serif';ctx.fillText('فاتورة '+inv.number,width-pad,222);ctx.fillText('التاريخ: '+dateShow(inv.createdAt),width-pad,260);
  ctx.fillText('العميل: '+(inv.customerName||'غير محدد'),width-pad,298);
  let y=350;ctx.strokeStyle='#ccdcd1';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(width-pad,y);ctx.stroke();y+=45;
  ctx.fillStyle='#185f36';ctx.font='bold 25px Tahoma, Arial, sans-serif';ctx.fillText('الأصناف',width-pad,y);
  ctx.textAlign='left';ctx.direction='ltr';ctx.fillText('القيمة',pad,y);y+=42;
  ctx.font='22px Tahoma, Arial, sans-serif';ctx.fillStyle='#1f3026';
  for(const it of its){const qty=displayQty({kind:it.kind,unit:it.unit},it.qtyBase);ctx.textAlign='right';ctx.direction='rtl';let label=it.productName+' — '+qty;
    while(ctx.measureText(label).width>760&&label.length>5)label=label.slice(0,-2);ctx.fillText(label,width-pad,y);
    ctx.textAlign='left';ctx.direction='ltr';ctx.fillText(moneyRaw(it.totalC||0)+' ج',pad,y);y+=lineHeight;
  }
  y+=5;ctx.strokeStyle='#ccdcd1';ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(width-pad,y);ctx.stroke();
  const totals=[['إجمالي الفاتورة',inv.totalC],['المدفوع وقت البيع',inv.cashC||0],['الآجل وقت البيع',inv.creditC||0]];
  for(const [label,c] of totals){y+=47;ctx.fillStyle='#184c30';ctx.textAlign='right';ctx.direction='rtl';ctx.font='bold 25px Tahoma, Arial, sans-serif';ctx.fillText(label,width-pad,y);ctx.textAlign='left';ctx.direction='ltr';ctx.fillText(money(c),pad,y)}
  ctx.textAlign='center';ctx.direction='rtl';ctx.font='19px Tahoma, Arial, sans-serif';ctx.fillStyle='#6b776c';ctx.fillText('رصيد العميل الحالي قد يختلف بسبب سداد أو مرتجع لاحق',width/2,height-45);
  await new Promise((resolve,reject)=>canvas.toBlob(blob=>{if(!blob)return reject(Error('تعذر توليد الصورة'));downloadBlob('Sedra_Credit_'+inv.number+'.png',blob);resolve()},'image/png'));
  toast('تم تجهيز صورة الفاتورة');
}
const v52OldInvoiceDetails=invoiceDetails;
invoiceDetails=async function(id){
  await v52OldInvoiceDetails(id);const inv=await one('invoices',id);if(!inv||!$('#sheetBody'))return;
  if(inv.creditC>0){
    $('#sheetBody').insertAdjacentHTML('beforeend','<div class="action-row spaced"><button class="btn primary" id="v52CreditPng">🖼 صورة فاتورة الآجل</button><button class="btn outline" id="v52CreditPdf">📄 PDF / طباعة</button></div><p class="hint">PDF: من نافذة الطباعة اختر حفظ كملف PDF. الصورة تعمل دون إنترنت.</p>');
    $('#v52CreditPng').onclick=()=>v52PngInvoice(id).catch(e=>toast(e.message));$('#v52CreditPdf').onclick=()=>v52PrintCredit(id);
  }
};
const v52OldCustomerDetail=renderCustomerDetail;
renderCustomerDetail=async function(cid){
  await v52OldCustomerDetail(cid);const el=$('#customerDetail .panel');if(!el)return;
  const btn=document.createElement('button');btn.className='btn small outline spaced';btn.textContent='📄 كشف حساب العميل PDF';btn.onclick=()=>v52PrintStatement(cid);el.insertBefore(btn,el.firstChild.nextSibling);
};
async function v52PrintStatement(cid){
  const w=window.open('','_blank');if(!w)return toast('اسمح بفتح نافذة طباعة كشف الحساب');
  try{
    const [customer,ledger]=await Promise.all([one('customers',cid),ledgerFor(cid)]);if(!customer)throw Error('العميل غير موجود');
    const balance=balanceC(ledger);const rows=ledger.slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(x=>`<tr><td>${esc(dateShow(x.createdAt))}</td><td>${esc(x.type==='invoice_credit'?'فاتورة آجل':x.type==='collection'?'تحصيل':'مرتجع')}</td><td>${esc(x.reference||'')}</td><td>${money(x.amountC)}</td></tr>`).join('');
    const page=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كشف حساب ${esc(customer.name)}</title><style>body{font-family:Tahoma,Arial,sans-serif;color:#213629;padding:25px}h1,h2{text-align:center;color:#14653a}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;text-align:right;padding:9px}.toolbar{background:#def3e4;padding:10px;text-align:center}@media print{.toolbar{display:none}@page{size:A4;margin:15mm}}</style></head><body><div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button></div><h1>سدرة</h1><h2>كشف حساب ${esc(customer.name)}</h2><h3>الرصيد الحالي: ${money(balance)}</h3><table><tr><th>التاريخ</th><th>العملية</th><th>المرجع</th><th>زيادة/نقص المديونية</th></tr>${rows}</table></body></html>`;
    w.document.open();w.document.write(page);w.document.close();
  }catch(e){w.close();toast('تعذر إنشاء كشف الحساب: '+e.message)}
}

/* Android PWA back button guard; browser/system can still force-close the app. */
let v52ExitMode='double',v52LastBack=0,v52Leaving=false;
async function v52LoadExitMode(){v52ExitMode=await setting('exitModeV52','double');$('#v52ExitMode').value=v52ExitMode}
$('#v52ExitMode').addEventListener('change',async e=>{v52ExitMode=e.target.value;await saveSetting('exitModeV52',v52ExitMode);toast('تم حفظ طريقة الخروج')});
function v52BackGuard(){try{history.pushState({sedraBackGuard:V52_BUILD},'',location.href)}catch{}}
window.addEventListener('popstate',()=>{
  if(v52Leaving)return;
  if(!$('#overlay').hidden){closeModal();v52BackGuard();return}
  if(currentPage!=='sell'){switchPage('sell');v52BackGuard();return}
  if(cart.size){if(confirm('هناك فاتورة لم يتم حفظها. هل تريد مغادرة التطبيق؟')){v52Leaving=true;history.back()}else v52BackGuard();return}
  const exitNow=v52ExitMode==='confirm'?confirm('هل تريد الخروج من كاشير سدرة؟'):Date.now()-v52LastBack<2000;
  if(exitNow){v52Leaving=true;history.back();return}
  v52LastBack=Date.now();toast('اضغط رجوع مرة ثانية خلال ثانيتين للخروج');v52BackGuard();
});
v52BackGuard();
const v52BaseInit=window.sedraUpgradeInit;
window.sedraUpgradeInit=async function(){await v52BaseInit?.();await v52LoadExitMode()};

window.sedraHasUnsavedCart=()=>cart.size>0;
