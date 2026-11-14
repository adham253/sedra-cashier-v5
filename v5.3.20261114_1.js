'use strict';
/* Sedra V5.3 — append-only corrections, optional credit archive, cash advances.
   Same IndexedDB and PWA identity. Never delete an original sale, return or ledger entry. */
const V53_BUILD='2026.11.14.1';
const v53Void=x=>x?.correctionVoided===true;
const v53VisibleItems=items=>items.filter(x=>!v53Void(x));
const v53DocumentInvoice=inv=>{
  const total=Math.max(0,(inv.totalC||0)-(inv.correctedOutC||0));
  const cash=Number(inv.cashC||0);
  return {...inv,totalC:total,grossC:Math.max(0,(inv.grossC??inv.totalC??0)-(inv.correctedGrossOutC||0)),
    discountC:Math.max(0,(inv.discountC||0)-(inv.correctedDiscountOutC||0)),creditC:Math.max(0,total-cash)};
};
const v53EffectiveTotal=inv=>Math.max(0,(inv.totalC||0)-(inv.correctedOutC||0));

/* Preserve historic returns, but do not show a mistaken item or its return on customer-facing copies. */
const v53OldPdfInvoice=v52InvoiceDocumentPages;
v52InvoiceDocumentPages=function(inv,items){return v53OldPdfInvoice(v53DocumentInvoice(inv),v53VisibleItems(items))};
const v53OldPngInvoice=v52PngInvoice;
v52PngInvoice=async function(id){
  // The original PNG exporter is retained for untouched invoices; the new path uses
  // the same high-resolution PDF canvas for corrected invoices, without a popup.
  const inv=await one('invoices',id);if(!inv)return toast('الفاتورة غير موجودة');
  if(!inv.correctedOutC)return v53OldPngInvoice(id);
  const items=(await all('items')).filter(x=>x.invoiceId===id&&!v53Void(x));
  const pages=v52InvoiceDocumentPages(inv,items);
  if(pages.length*V52_PDF_HEIGHT>16000)return toast('الفاتورة أطول من حد الصورة الواحدة. استخدم حفظ PDF لإظهار كل البنود');
  const canvas=document.createElement('canvas');canvas.width=V52_PDF_WIDTH;canvas.height=V52_PDF_HEIGHT*pages.length;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('تعذر تجهيز صورة الفاتورة');
  pages.forEach((page,i)=>ctx.drawImage(page,0,i*V52_PDF_HEIGHT));
  await new Promise((resolve,reject)=>canvas.toBlob(blob=>{
    if(!blob)return reject(Error('تعذر إنشاء الصورة'));
    downloadBlob('Sedra_Corrected_'+inv.number+'.png',blob);resolve();
  },'image/png'));
  toast('تم تنزيل صورة الفاتورة المصححة');
};
const v53OldPrintInvoice=printInvoice;
printInvoice=async function(id){
  const inv=await one('invoices',id);
  return inv?.correctedOutC?v52PrintCredit(id):v53OldPrintInvoice(id);
};

/* Historic corrections are financial events on the correction date; the original
   sale and its real, already-booked return remain unchanged in the audit trail. */
const v53OldSalesStats=v52SalesStats;
v52SalesStats=async function(filter='all',from='',to=''){
  const result=await v53OldSalesStats(filter,from,to);
  const match=v52Period(filter,from,to);
  const corrections=(await all('audit')).filter(x=>x.action==='invoice_item_corrected'&&match(x.dateKey));
  const saleChange=corrections.reduce((s,x)=>s+(x.netSaleAdjustmentC||0),0);
  const costChange=corrections.reduce((s,x)=>s+(x.costAdjustmentC||0),0);
  result.netSalesC+=saleChange;
  result.netCostC+=costChange;
  result.profitC+=saleChange-costChange;
  result.correctionsC=saleChange;
  return result;
};
salesStats=v52SalesStats;
const v53OldDaySummary=v52SummaryForDate;
v52SummaryForDate=function(dk,data){
  const r=v53OldDaySummary(dk,data);
  const edits=(data.corrections||[]).filter(x=>x.dateKey===dk&&x.action==='invoice_item_corrected');
  r.correctionsC=edits.reduce((s,x)=>s+(x.netSaleAdjustmentC||0),0);
  r.netSalesC+=r.correctionsC;
  return r;
};
const v53OldRenderInvoices=renderInvoices;
renderInvoices=async function(){
  await v53OldRenderInvoices();
  if(!db||currentPage!=='invoices')return;
  const [invs,edits]=await Promise.all([all('invoices'),all('audit')]);
  const m=new Map(invs.map(x=>[x.id,x]));
  for(const card of $$('#invoiceList [data-invoice]')){
    const inv=m.get(card.dataset.invoice),b=card.querySelector('.card-top>b');
    if(inv&&inv.correctedOutC&&b){b.textContent=money(v53EffectiveTotal(inv));
      card.querySelector('.card-meta')?.insertAdjacentHTML('beforeend',' <span class="badge">مصححة</span>');}
  }
  const existing=$('#invoiceStats');
  const filter=$('#invoiceFilter').value,from=$('#v52DateFrom')?.value||'',to=filter==='range'?$('#v52DateTo')?.value||'':from;
  const sum=edits.filter(x=>x.action==='invoice_item_corrected'&&v52Period(filter,from,to)(x.dateKey)).reduce((n,x)=>n+(x.netSaleAdjustmentC||0),0);
  if(sum)existing?.insertAdjacentHTML('beforeend',v52MoneyTiles('تصحيحات بنود الفواتير خلال الفترة',sum));
};

/* Customer account collections were not linked to individual invoices in V5.2.
   For ARCHIVE ELIGIBILITY ONLY, assign untargeted collections FIFO (oldest debt first).
   Returns/corrections target their original invoice first. No ledger records are changed. */
function v53AllocateLedger(entries,invoices){
  const invoiceByNumber=new Map(invoices.map(i=>[i.number,i.id]));
  const invoiceById=new Map(invoices.map(i=>[i.id,i]));
  const buckets=[],byKey=new Map();let unappliedCreditC=0;
  const allocation=[];
  const consume=(bucket,amt)=>{const use=Math.min(amt,Math.max(0,bucket.remainingC));bucket.remainingC-=use;return amt-use};
  const pay=(amount,preferredId)=>{
    let rest=amount;
    const target=byKey.get(preferredId);
    if(target)rest=consume(target,rest);
    for(const bucket of buckets){if(rest<=0)break;if(bucket===target)continue;rest=consume(bucket,rest)}
    if(rest>0)unappliedCreditC+=rest;
  };
  const sorted=entries.slice().sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id||'').localeCompare(String(b.id||'')));
  for(const e of sorted){
    const amount=Math.round(Number(e.amountC||0));if(!amount)continue;
    if(amount>0){
      const key=e.type==='invoice_credit'?(e.invoiceId||invoiceByNumber.get(e.reference)||'missing:'+e.id):e.id;
      const bucket={key,remainingC:amount,kind:e.type,invoiceId:e.type==='invoice_credit'?key:null,createdAt:e.createdAt};
      buckets.push(bucket);byKey.set(key,bucket);
      if(unappliedCreditC){unappliedCreditC=consume(bucket,unappliedCreditC)}
    }else{
      const targeted=['return_credit','invoice_item_correction'].includes(e.type);
      const invoiceId=e.invoiceId||invoiceByNumber.get(e.reference);
      pay(-amount,targeted?invoiceId:null);
    }
  }
  for(const inv of invoices){if(inv.creditC>0&&!byKey.has(inv.id)){
    // Legacy invoice whose original credit entry is not present: do not claim it is paid.
    byKey.set(inv.id,{key:inv.id,remainingC:inv.creditC,unverified:true});
  }}
  return {remainingByInvoice:new Map(invoices.map(i=>[i.id,byKey.get(i.id)?.remainingC??0])),buckets,unappliedCreditC};
}

let v53ArchiveTab='current',v53ArchiveQuery='';
async function v53InvoiceBalanceForCustomer(cid){
  const [invoices,led]=await Promise.all([all('invoices'),ledgerFor(cid)]);
  const invs=invoices.filter(x=>x.customerId===cid&&x.creditC>0);
  return v53AllocateLedger(led,invs).remainingByInvoice;
}
async function v53ArchiveInvoice(id,archive){
  const inv=await one('invoices',id);if(!inv||!inv.customerId||!(inv.creditC>0))return toast('لا يمكن أرشفة هذه الفاتورة');
  const remaining=await v53InvoiceBalanceForCustomer(inv.customerId);
  if(archive&&(remaining.get(id)??inv.creditC)>0)return toast('الفاتورة غير مسددة بالكامل؛ لا يمكن أرشفتها');
  if(!confirm((archive?'نقل الفاتورة إلى الأرشيف':'استرجاع الفاتورة للقائمة الحالية')+'؟\n'+inv.number+'\nلن يتغير المخزون أو المبيعات أو الخزنة.'))return;
  const at=now(),tx=db.transaction(['invoices','audit'],'readwrite');
  inv.archivedAt=archive?at:null;
  tx.objectStore('invoices').put(inv);
  tx.objectStore('audit').add({id:uid('AU'),action:archive?'credit_invoice_archived':'credit_invoice_restored',invoiceId:id,reference:inv.number,actor:'cashier',createdAt:at,dateKey:day()});
  await done(tx);toast(archive?'اتنقلت الفاتورة للأرشيف':'رجعت الفاتورة للقائمة');
  renderCustomerDetail(inv.customerId);
}

/* Cash handed to a customer: decrease drawer; increase customer receivable.
   It is NOT a sale, purchase, expense, or stock movement. */
async function v53OpenCashAdvance(cid){
  if(!await requireOpenDay())return;
  if(!await ensureAdmin())return;
  const c=await one('customers',cid);if(!c)return toast('العميل غير موجود');
  const finance=await currentFinance();
  modal('سحب نقدي على حساب العميل',`<p class="help">العميل: <b>${esc(c.name)}</b></p><div class="stat"><small>الرصيد الدفتري المتوقع في الخزنة</small><b>${money(finance.cashExpectedC)}</b></div>${field('v53AdvanceAmount','المبلغ المسحوب (جنيه)','','number')}${field('v53AdvanceReason','ملاحظة / سبب السحب','','text')}<p class="hint">السحب ينقص الخزنة ويزيد مديونية العميل، ولا يُسجل كمبيعات أو مصروفات. تأكد من وجود النقد فعليًا.</p><button class="btn primary block spaced" id="v53AdvanceConfirm">تأكيد السحب النقدي</button>`);
  $('#v53AdvanceConfirm').onclick=async()=>{
    const raw=num($('#v53AdvanceAmount').value),amount=cents(raw),reason=$('#v53AdvanceReason').value.trim();
    if(!Number.isFinite(raw)||raw<=0||!Number.isSafeInteger(amount)||amount<=0||!reason)return toast('اكتب مبلغ صحيح وسبب السحب');
    const f=await currentFinance();
    if(amount>f.cashExpectedC)return toast('المبلغ أكبر من رصيد الخزنة الدفتري؛ راجع الخزنة أولًا');
    if(!confirm(`تأكيد تسليم ${money(amount)} نقدًا للعميل ${c.name}؟\nالخزنة تنقص ${money(amount)} ومديونية العميل تزيد بنفس المبلغ.`))return;
    if(saving)return;saving=true;
    try{
      const at=now(),dk=day(),aid=uid('ADV'),tx=db.transaction(['cash','ledger','audit'],'readwrite');
      tx.objectStore('cash').add({id:uid('CA'),advanceId:aid,customerId:cid,amountC:-amount,type:'credit_cash_advance',reference:'سحب نقدي: '+c.name+' / '+reason,createdAt:at,dateKey:dk});
      tx.objectStore('ledger').add({id:uid('LE'),advanceId:aid,customerId:cid,amountC:amount,type:'cash_advance',reference:'سحب نقدي: '+reason,createdAt:at,dateKey:dk});
      tx.objectStore('audit').add({id:uid('AU'),action:'credit_cash_advance',advanceId:aid,customerId:cid,amountC:amount,reference:reason,actor:'admin',createdAt:at,dateKey:dk});
      await done(tx);closeModal();toast('تم تسجيل السحب في الخزنة وحساب العميل');
      renderCustomers();renderCustomerDetail(cid);
    }catch(e){console.error(e);toast('فشل السحب؛ لم يتم اعتماد العملية')}
    finally{saving=false}
  };
}

/* Item correction: original row and old real return remain immutable for audit.
   Restore only the quantity that was NOT already returned. Financial adjustment is
   item net value AFTER any return, so no double-credit. When overpaid, customer
   balance can become negative (a customer credit); we NEVER invent a cash refund. */
async function v53CorrectItem(invoiceId,itemId){
  if(!await requireOpenDay())return;
  if(!await ensureAdmin())return;
  const [inv,line,returns]=await Promise.all([one('invoices',invoiceId),one('items',itemId),all('returns')]);
  if(!inv||!line||line.invoiceId!==invoiceId||!inv.customerId||v53Void(line))return toast('هذا السطر غير متاح للتصحيح');
  const returned=returns.filter(r=>r.itemId===itemId),returnedC=returned.reduce((s,r)=>s+(r.amountC||0),0);
  const returnedQty=returned.reduce((s,r)=>s+Number(r.qtyBase||0),0);
  const restQty=Math.round((Number(line.qtyBase)-returnedQty)*100)/100;
  const netValue=(line.totalC||0)-returnedC;
  if(restQty<-.001||netValue<0||Math.abs(returnedC-Number(line.returnedC||0))>1||Math.abs(returnedQty-Number(line.returnedQtyBase||0))>.011)
    return toast('هناك اختلاف في سجل المرتجع. لا يمكن تعديل السطر قبل مراجعة البيانات');
  modal('تصحيح صنف أُضيف بالخطأ',`<div class="list-card"><b>${esc(inv.number)}</b><div class="card-meta">العميل: ${esc(inv.customerName||'')}</div><div class="split"><span>${esc(line.productName)}</span><b>${money(line.totalC||0)}</b></div><div class="card-meta">تم رده بالفعل: ${money(returnedC)} · القيمة المتبقية للتصحيح: ${money(netValue)}</div></div><p class="help">سيُخفى الصنف ومرتجعه المرتبط به من نسخة العميل، مع بقاء السجل الأصلي للإدارة. إعادة المخزون فقط للكمية التي لم تُرد سابقًا: ${esc(displayQty({kind:line.kind,unit:line.unit},Math.max(0,restQty)))}.</p>${field('v53CorrectionReason','سبب تصحيح البند (إجباري)','أضيف بالخطأ إلى حساب عميل آخر')}<button class="btn danger block spaced" id="v53CorrectionConfirm">تأكيد حذف البند من نسخة العميل</button>`);
  $('#v53CorrectionConfirm').onclick=async()=>{
    const reason=$('#v53CorrectionReason').value.trim();if(reason.length<4)return toast('اكتب سبب تصحيح واضح');
    if(!confirm(`تأكيد تصحيح ${line.productName} في فاتورة ${inv.number}؟\nإزالة ${money(line.totalC||0)} من نسخة العميل.\nأثر جديد على المديونية: ${money(-netValue)}.\nإرجاع مخزون إضافي: ${displayQty({kind:line.kind,unit:line.unit},Math.max(0,restQty))}.\nلن يتم تسجيل استرداد نقدي وهمي.`))return;
    if(saving)return;saving=true;
    try{
      // Repeat read after confirmation. One app device must be the sole writer.
      const fresh=await one('items',itemId),freshInv=await one('invoices',invoiceId);
      if(!fresh||v53Void(fresh)||!freshInv||Math.abs(Number(fresh.returnedQtyBase||0)-returnedQty)>.011||Math.abs(Number(fresh.returnedC||0)-returnedC)>1)throw Error('تم تعديل السطر أو مرتجعه قبل التصحيح؛ أعد فتح الفاتورة');
      const at=now(),dk=day(),tx=db.transaction(['items','invoices','products','stock','ledger','audit'],'readwrite');
      fresh.correctionVoided=true;fresh.correctionAt=at;fresh.correctionReason=reason;
      tx.objectStore('items').put(fresh);
      freshInv.correctedOutC=(freshInv.correctedOutC||0)+(fresh.totalC||0);
      freshInv.correctedGrossOutC=(freshInv.correctedGrossOutC||0)+(fresh.grossC??fresh.totalC??0);
      freshInv.correctedDiscountOutC=(freshInv.correctedDiscountOutC||0)+(fresh.discountC||0);
      freshInv.correctionCount=(freshInv.correctionCount||0)+1;
      tx.objectStore('invoices').put(freshInv);
      if(restQty>.000001){
        const store=tx.objectStore('products'),r=store.get(fresh.productId);
        r.onsuccess=()=>{const p=r.result;if(!p){tx.abort();return}p.stockQty=Math.round((Number(p.stockQty||0)+restQty)*100)/100;store.put(p)};
        tx.objectStore('stock').add({id:uid('ST'),productId:fresh.productId,qtyBase:restQty,type:'invoice_item_correction',reference:inv.number,itemId,createdAt:at,dateKey:dk});
      }
      if(netValue>0)tx.objectStore('ledger').add({id:uid('LE'),customerId:inv.customerId,invoiceId,itemId,amountC:-netValue,type:'invoice_item_correction',reference:inv.number,createdAt:at,dateKey:dk});
      const known=v52KnownCost(fresh),remainingRatio=fresh.qtyBase>0?Math.max(0,restQty/fresh.qtyBase):0;
      const costReverseC=known?Math.round(fresh.costTotalC*remainingRatio):netValue;
      tx.objectStore('audit').add({id:uid('AU'),action:'invoice_item_corrected',invoiceId,itemId,productId:fresh.productId,reference:inv.number,actor:'admin',reason,itemTotalC:fresh.totalC,returnedBeforeC:returnedC,restoredQtyBase:restQty,netSaleAdjustmentC:-netValue,costAdjustmentC:-costReverseC,createdAt:at,dateKey:dk});
      await done(tx);closeModal();toast('تم تصحيح الفاتورة مع الحفاظ على السجل المحاسبي');
      if(currentPage==='credit')renderCustomerDetail(inv.customerId);else if(currentPage==='invoices')renderInvoices();
      refreshSaleWarnings();
    }catch(e){console.error(e);toast('تعذر التصحيح: '+(e.message||''))}
    finally{saving=false}
  };
}

/* Never offer a corrected item as a future return. */
const v53OldOpenReturn=openReturn;
openReturn=async function(id){
  const items=(await all('items')).filter(it=>it.invoiceId===id&&!v53Void(it)&&it.qtyBase-(it.returnedQtyBase||0)>.000001);
  if(!items.length)return toast('لا توجد أصناف قابلة للمرتجع في هذه الفاتورة');
  await v53OldOpenReturn(id);
  const select=$('#returnItem');if(!select)return;
  for(const option of [...select.options])if(!items.some(it=>it.id===option.value))option.remove();
  if(select.options.length){select.value=select.options[0].value;select.dispatchEvent(new Event('change'))}
};

const v53OldInvoiceDetails=invoiceDetails;
invoiceDetails=async function(id){
  await v53OldInvoiceDetails(id);
  const inv=await one('invoices',id),body=$('#sheetBody');if(!inv||!body)return;
  const [items,rets]=await Promise.all([all('items'),all('returns')]);
  const own=items.filter(it=>it.invoiceId===id),visible=v53VisibleItems(own),hidden=new Set(own.filter(v53Void).map(x=>x.id));
  const net=v53DocumentInvoice(inv);
  const first=body.querySelector(':scope > .stat b');if(first)first.textContent=money(net.totalC);
  const table=body.querySelector('.item-table tbody');
  if(table)table.innerHTML=visible.map(it=>`<tr><td>${esc(it.productName)}</td><td>${esc(displayQty({kind:it.kind,unit:it.unit},it.qtyBase))}</td><td>${money(it.totalC)}</td></tr>`).join('')||'<tr><td colspan="3">تم تصحيح جميع البنود</td></tr>';
  const visibleReturns=rets.filter(r=>r.invoiceId===id&&!hidden.has(r.itemId));
  for(const h of body.querySelectorAll('b'))if(h.textContent==='مرتجعات الفاتورة'){
    const node=h.nextElementSibling;
    if(node?.classList.contains('ledger')){
      if(!visibleReturns.length){h.style.display='none';node.style.display='none'}
      else node.innerHTML=visibleReturns.map(r=>`<div class="ledger-row"><small>${dateShow(r.createdAt)} · ${esc(r.productName)}</small><b>${money(r.amountC)}</b></div>`).join('');
    }
  }
  const pricing=body.querySelector('.list-card.spaced');
  if(pricing&&inv.correctionCount){
    const amounts=pricing.querySelectorAll('.split b');
    if(amounts[0])amounts[0].textContent=money(net.grossC);
    if(amounts[1])amounts[1].textContent=money(net.discountC);
  }
  if(inv.customerId){
    const box=document.createElement('div');box.className='list-card spaced';
    box.innerHTML='<b>تصحيح بنود الآجل — إدارة</b><p class="hint">الحذف هنا يخفي البند الخاطئ ومرتجعه من نسخة العميل، ولا يمسح سجلات المراجعة.</p>'+
      visible.map(it=>`<div class="split"><span>${esc(it.productName)} · ${money(it.totalC)}</span><button class="btn small outline" data-v53-correct="${esc(it.id)}">تصحيح / حذف بند</button></div>`).join('')+
      (hidden.size?`<p class="hint">عدد البنود المصححة: ${hidden.size} (محفوظة في سجل الإدارة فقط).</p>`:'');
    body.appendChild(box);
    box.querySelectorAll('[data-v53-correct]').forEach(btn=>btn.onclick=()=>v53CorrectItem(id,btn.dataset.v53Correct));
  }
};

/* Sanitize statements for customer export by merging historic mistaken returns and
   correction events into the corrected invoice debit, preserving exact final balance. */
function v53CleanStatementEntries(entries,invoices,items,returns){
  const voidIds=new Set(items.filter(v53Void).map(x=>x.id));
  const debitAdjustment=new Map(),suppressed=new Set();
  const invoiceIdByNumber=new Map(invoices.map(i=>[i.number,i.id]));
  for(const e of entries)if(e.type==='invoice_item_correction'){
    suppressed.add(e.id);debitAdjustment.set(e.invoiceId,(debitAdjustment.get(e.invoiceId)||0)+e.amountC);
  }
  const historicReturns=returns.filter(r=>voidIds.has(r.itemId)&&r.creditC);
  for(const ret of historicReturns){
    const e=entries.find(x=>x.type==='return_credit'&&x.reference===ret.invoiceNumber&&x.createdAt===ret.createdAt&&x.amountC===-ret.creditC&&!suppressed.has(x.id));
    if(e){suppressed.add(e.id);debitAdjustment.set(ret.invoiceId,(debitAdjustment.get(ret.invoiceId)||0)+e.amountC)}
  }
  return entries.filter(e=>!suppressed.has(e.id)).map(e=>{
    if(e.type!=='invoice_credit')return e;
    const invoiceId=e.invoiceId||invoiceIdByNumber.get(e.reference);
    return {...e,amountC:e.amountC+(debitAdjustment.get(invoiceId)||0)};
  });
}
v52PrintStatement=async function(cid){
  try{
    const [customer,ledger,invoices,items,returns]=await Promise.all([one('customers',cid),ledgerFor(cid),all('invoices'),all('items'),all('returns')]);
    if(!customer)throw Error('العميل غير موجود');
    const invoiceList=invoices.filter(i=>i.customerId===cid&&i.creditC>0).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
    const clientEntries=v53CleanStatementEntries(ledger,invoiceList,items,returns).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
    const balance=balanceC(ledger),pages=v52StatementDocumentPages(customer,clientEntries,balance);
    for(const inv of invoiceList)pages.push(...v52InvoiceDocumentPages(inv,items.filter(it=>it.invoiceId===inv.id)));
    v52ShowDocPreview('كشف حساب وفواتير تفصيلية ('+invoiceList.length+') — PDF','Sedra_Statement_'+customer.name.replace(/[\\/:*?"<>|]/g,'_')+'.pdf',pages);
  }catch(e){console.error(e);toast('تعذر تجهيز كشف الحساب: '+(e.message||''))}
};

const v53OldCustomerDetail=renderCustomerDetail;
renderCustomerDetail=async function(cid){
  await v53OldCustomerDetail(cid);
  const panel=$('#customerDetail .panel');if(!panel)return;
  const [invoices,ledger,items,returns]=await Promise.all([all('invoices'),ledgerFor(cid),all('items'),all('returns')]);
  const list=invoices.filter(i=>i.customerId===cid&&i.creditC>0).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const due=v53AllocateLedger(ledger,list).remainingByInvoice;
  const listNode=panel.querySelector(':scope > .stack');
  if(!listNode)return;
  const current=list.filter(i=>!i.archivedAt||(due.get(i.id)||0)>0),archived=list.filter(i=>i.archivedAt&&(due.get(i.id)||0)<=0);
  const h=[...panel.querySelectorAll('h2')].find(x=>x.textContent.includes('فواتير العميل'));
  if(h)h.textContent='فواتير العميل — الحالية والأرشيف';
  const filter=document.createElement('div');filter.className='action-row mini-actions';
  filter.innerHTML=`<button class="btn small ${v53ArchiveTab==='current'?'primary':'outline'}" id="v53ViewCurrent">الحالية (${current.length})</button><button class="btn small ${v53ArchiveTab==='archive'?'primary':'outline'}" id="v53ViewArchive">الأرشيف (${archived.length})</button>`;
  listNode.before(filter);
  const search=document.createElement('input');search.className='field';search.id='v53ArchiveSearch';search.placeholder='بحث في الأرشيف برقم الفاتورة أو التاريخ';search.value=v53ArchiveQuery;search.style.display=v53ArchiveTab==='archive'?'block':'none';
  filter.after(search);
  const shown=v53ArchiveTab==='archive'?archived:current;
  listNode.innerHTML=shown.map(i=>{
    const d=due.get(i.id)??i.creditC,paid=d<=0,archivedHere=!!i.archivedAt;
    return `<div class="list-card" data-v53invoice="${esc(i.id)}"><div class="card-top"><b>${esc(i.number)}</b><b>${money(v53EffectiveTotal(i))}</b></div><div class="card-meta">${dateShow(i.createdAt)} · متبقي مخصص للفاتورة ${money(d)} ${i.correctedOutC?' · مصححة':''}</div><div class="action-row mini-actions"><button class="btn small outline" data-v53open="${esc(i.id)}">تفاصيل</button>${archivedHere?`<button class="btn small outline" data-v53restore="${esc(i.id)}">استرجاع</button>`:paid?`<button class="btn small secondary" data-v53archive="${esc(i.id)}">أرشفة الفاتورة</button>`:'<span class="hint">تحتاج السداد أولًا</span>'}</div></div>`;
  }).join('')||'<div class="blank">لا توجد فواتير في هذا القسم</div>';
  $('#v53ViewCurrent').onclick=()=>{v53ArchiveTab='current';v53ArchiveQuery='';renderCustomerDetail(cid)};
  $('#v53ViewArchive').onclick=()=>{v53ArchiveTab='archive';v53ArchiveQuery='';renderCustomerDetail(cid)};
  const filterArchive=()=>{if(v53ArchiveTab!=='archive')return;for(const card of listNode.querySelectorAll('[data-v53invoice]')){const inv=list.find(x=>x.id===card.dataset.v53invoice);card.style.display=inv&&norm(inv.number+' '+inv.createdAt).includes(norm(v53ArchiveQuery))?'':'none'}};
  search.oninput=e=>{v53ArchiveQuery=e.target.value;filterArchive()};filterArchive();
  listNode.querySelectorAll('[data-v53open]').forEach(b=>b.onclick=()=>invoiceDetails(b.dataset.v53open));
  listNode.querySelectorAll('[data-v53archive]').forEach(b=>b.onclick=()=>v53ArchiveInvoice(b.dataset.v53archive,true));
  listNode.querySelectorAll('[data-v53restore]').forEach(b=>b.onclick=()=>v53ArchiveInvoice(b.dataset.v53restore,false));
  const entry=document.createElement('button');entry.className='btn outline block spaced';entry.id='v53CashAdvanceBtn';entry.textContent='💵 سحب نقدي على حساب العميل';entry.onclick=()=>v53OpenCashAdvance(cid);
  const collect=panel.querySelector('#receiptCustomer');if(collect)collect.after(entry);
  const stats=panel.querySelectorAll(':scope > .stats .stat b');
  if(stats[0])stats[0].textContent=money(invoices.filter(i=>i.customerId===cid).reduce((s,i)=>s+v53EffectiveTotal(i),0));
  const hiddenIds=new Set(items.filter(x=>v53Void(x)).map(x=>x.id));
  if(stats[2])stats[2].textContent=money(returns.filter(r=>r.invoiceId&&invoices.some(i=>i.customerId===cid&&i.id===r.invoiceId)&&!hiddenIds.has(r.itemId)).reduce((s,r)=>s+(r.amountC||0),0));
  const ledgerNode=panel.querySelector('.ledger');
  if(ledgerNode){
    const sorted=ledger.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    ledgerNode.innerHTML=sorted.map(e=>`<div class="ledger-row"><div><b>${e.type==='cash_advance'?'سحب نقدي':e.type==='invoice_item_correction'?'تصحيح بند فاتورة':e.type==='invoice_credit'?'فاتورة آجل':e.type==='collection'?'سداد من العميل':e.type==='return_credit'?'مرتجع — تخفيض رصيد':'حركة حساب'}</b><small>${dateShow(e.createdAt)} · ${esc(e.reference||'')}</small></div><b class="${e.amountC>0?'amber':'positive'}">${e.amountC>0?'+':'−'}${money(Math.abs(e.amountC))}</b></div>`).join('');
  }
  const hint=document.createElement('p');hint.className='hint';hint.textContent='أرشفة الفاتورة اختيارية بعد سدادها. التحصيلات القديمة تُوزّع على أقدم مديونية أولًا لأغراض عرض حالة الفاتورة فقط، ولا يتغيّر أي قيد.';
  listNode.after(hint);
};
const v53OldRenderCustomers=renderCustomers;
renderCustomers=async function(){
  await v53OldRenderCustomers();
  const [invs,ledger]=await Promise.all([all('invoices'),all('ledger')]);
  const total=invs.filter(x=>x.creditC>0).reduce((s,x)=>s+v53EffectiveTotal(x),0);
  const first=$('#creditGlobalStats .stat b');if(first)first.textContent=money(total);
  const withdrawn=ledger.filter(x=>x.type==='cash_advance').reduce((s,x)=>s+(x.amountC||0),0);
  if(withdrawn)$('#creditGlobalStats').insertAdjacentHTML('beforeend',v52MoneyTiles('سحب نقدي على حساب العملاء',withdrawn));
};

/* Preserve confirmation UX: capturer runs before the existing save handler; no changes
   to the source cart or invoice screen and no extra modal/window. */
document.addEventListener('click',function(event){
  const button=event.target.closest?.('#confirmPartial');
  if(!button)return;
  const sel=$('#saleCustomer'),cid=sel?.value;
  if(!cid)return;
  const name=sel?.selectedOptions?.[0]?.textContent?.trim()||'عميل غير محدد';
  if(!confirm('تأكيد حفظ الفاتورة على حساب العميل:\n'+name+'\nهل هذا هو العميل الصحيح؟')){
    event.preventDefault();event.stopImmediatePropagation();
  }
},true);

/* Show actual theoretical STOCK profit, not stock purchase value repeated as profit. */
async function v53StockProfit(){
  let valueC=0,costC=0,unknownValueC=0,unknownCount=0,negative=0;
  for(const p of await all('products')){
    if(p.active===false)continue;
    const qty=Number(p.stockQty)||0;if(qty<0){negative++;continue}if(qty===0)continue;
    const sell=isWeight(p)?Math.round((p.priceC||0)*qty/1000):Math.round((p.priceC||0)*qty);
    const unitCost=p.costEstimateDueToLegacyStock?null:priceForBase(p);
    if(unitCost===null){unknownCount++;unknownValueC+=sell;continue}
    valueC+=sell;costC+=Math.round(unitCost*qty);
  }
  return {valueC,costC,profitC:valueC-costC,unknownValueC,unknownCount,negative};
}
const v53OldSummaryRender=summaryRender;
summaryRender=async function(){
  await v53OldSummaryRender();const stats=$('#businessSummary');if(!stats)return;
  const calc=await v53StockProfit();
  const tile=document.createElement('div');tile.className='stat dashboard-tile';
  tile.innerHTML=`<small>المكسب النظري للمخزون الحالي${calc.unknownCount?' (للأصناف المعروفة التكلفة)':''}</small><b class="${calc.profitC>=0?'positive':'amber'}">${money(calc.profitC)}</b>`;
  stats.insertBefore(tile,stats.children[3]||null);
  if(calc.unknownCount)$('#businessSummaryWarnings')?.insertAdjacentHTML('beforeend',`<div class="summary-warn">⚠ ${calc.unknownCount} صنفًا قيمتها البيعية ${money(calc.unknownValueC)} مستبعدة من حساب المكسب لغياب تكلفة شراء مؤكدة، وليس لأن ربحها صفر.</div>`);
};
