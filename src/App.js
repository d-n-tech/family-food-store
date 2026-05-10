import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { supabase } from "./supabase";

// ── Constants ─────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function daysLeft(d, s) { return Math.ceil((new Date(d).getTime() + s*86400000 - Date.now())/86400000); }

const SHELF_OPTIONS = [
  {label:"1 week",days:7},{label:"2 weken",days:14},{label:"1 maand",days:30},
  {label:"3 maanden",days:90},{label:"6 maanden",days:180},{label:"1 jaar",days:365},
];
const UNIT_OPTIONS = ["g","kg","ml","L","stuks","portie"];
const CATEGORIES = ["🥩 Vlees","🐟 Vis","🥦 Groenten","🍎 Fruit","🧀 Zuivel","🍞 Brood & gebak","🥫 Droog & conserven","🍝 Pasta & rijst","🥚 Eieren","🧃 Dranken","❄ Diepvries kant-en-klaar","📦 Andere"];

// ── Hooks ─────────────────────────────────────────────────────────
function useLongPress(cb, ms=600) {
  const t=useRef(null), f=useRef(false);
  const start=useCallback(()=>{f.current=false;t.current=setTimeout(()=>{f.current=true;cb();},ms);},[cb,ms]);
  const cancel=useCallback(()=>clearTimeout(t.current),[]);
  const click=useCallback(e=>{if(f.current)e.stopPropagation();},[]);
  return{onMouseDown:start,onTouchStart:start,onMouseUp:cancel,onMouseLeave:cancel,onTouchEnd:cancel,onClick:click};
}

// ── UI atoms ──────────────────────────────────────────────────────
function StatusPill({days}) {
  if(days<=0) return <span className="pill exp">Verlopen</span>;
  if(days<=14) return <span className="pill warn">⚠ {days}d</span>;
  if(days<=30) return <span className="pill soon">{days}d</span>;
  return <span className="pill ok">{days}d</span>;
}

function BottomSheet({onClose,title,children}) {
  return (
    <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}>
      <div className="sheet">
        <div className="sheet-title">{title}<button className="xbtn" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

// ── Barcode lookup ────────────────────────────────────────────────
async function lookupBarcode(code, set) {
  if(!code.trim()) return false;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code.trim()}.json`);
    const d = await r.json();
    if(d.status===1 && d.product){
      const p = d.product;
      set("name", p.product_name_nl || p.product_name || code);
      set("barcode", code.trim());
      if(p.quantity){ const num = p.quantity.replace(/[^0-9.]/g,""); if(num) set("qty", num); }
      return true;
    }
  } catch(e){}
  set("barcode", code.trim());
  return false;
}

// Native barcode input — works on iPhone via camera or manual entry
function BarcodeInput({onLookup, scanLoading}) {
  const [manual, setManual] = useState("");
  return(
    <div className="barcode-row">
      <input className="inp" style={{flex:1}}
        placeholder="Barcode nummer (of typ naam hierboven)…"
        value={manual} onChange={e=>setManual(e.target.value)}
        onKeyDown={e=>{ if(e.key==="Enter" && manual.trim()){ onLookup(manual); setManual(""); }}}
        inputMode="numeric" />
      <button className="scan-btn" disabled={!manual.trim()||scanLoading}
        onClick={()=>{ if(manual.trim()){ onLookup(manual); setManual(""); } }}>
        {scanLoading?"⏳":"🔍"}
      </button>
      <label className="scan-btn" title="Open camera — richt op barcode, iOS leest automatisch">
        📷
        <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
          onChange={()=>{}}/>
      </label>
    </div>
  );
}

// ── ItemCard ──────────────────────────────────────────────────────
function ItemCard({item,onLongPress,showLocation,freezerName,bagName}) {
  const days=daysLeft(item.date_added,item.shelf_days);
  const lp=useLongPress(onLongPress,600);
  const belowMin=item.min_pieces!=null && item.pieces<=item.min_pieces;
  return(
    <div className={`card ${days<=0?"c-exp":days<=14?"c-warn":""} ${item.pieces===0?"c-empty":""} ${belowMin&&item.pieces>0?"c-low":""}`} {...lp}>
      <div className="cm">
        <div className="cn">{item.name}{belowMin&&item.pieces>0&&<span className="low-tag">↓ min</span>}</div>
        <div className="cmt">
          {showLocation&&<>{freezerName(item.freezer_id)}{item.bag_id?` · 📦 ${bagName(item.bag_id)}`:""} · </>}
          {item.category?`${item.category} · `:""}
          {item.qty?`${item.qty}${item.unit} · `:""}
          📅 {new Date(item.date_added).toLocaleDateString("nl-BE")}
        </div>
      </div>
      <div className="cr">
        <StatusPill days={days}/>
        <span className="qnum">{item.pieces} st</span>
      </div>
    </div>
  );
}

// ── BagSection ────────────────────────────────────────────────────
function BagSection({bag,items,onEditBag,onDeleteBag,onLongPressItem}) {
  const [open,setOpen]=useState(true);
  return(
    <div className="bag-block">
      <div className="bag-hdr" onClick={()=>setOpen(o=>!o)}>
        <span className="bag-label">📦 {bag.name}</span>
        <div className="bag-actions" onClick={e=>e.stopPropagation()}>
          <button className="s-edit sm" onClick={onEditBag}>✏</button>
          <button className="s-del sm" onClick={onDeleteBag}>🗑</button>
          <span className="bag-toggle">{open?"▲":"▼"}</span>
        </div>
      </div>
      {open&&(items.length===0?<div className="bag-empty">Leeg</div>:items.map(item=><ItemCard key={item.id} item={item} onLongPress={()=>onLongPressItem(item)}/>))}
    </div>
  );
}

// ── ItemForm ──────────────────────────────────────────────────────
function ItemForm({item,freezers,bags,allItems,shops,onSave,onDelete,onClose,onAddToList}) {
  const blank={name:"",freezer_id:freezers[0]?.id??"",bag_id:null,pieces:1,qty:"",unit:"g",
    date_added:new Date().toISOString().slice(0,10),shelf_days:180,category:CATEGORIES[0],
    min_pieces:null,barcode:""};
  const [form,setForm]=useState(item??blank);
  const [scanLoading,setScanLoading]=useState(false);
  const [showSugg,setShowSugg]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const bagsForFreezer=bags.filter(b=>b.freezer_id===form.freezer_id);
  const freezerName=id=>freezers.find(f=>f.id===id)?.name??"?";
  const bagName=id=>id?(bags.find(b=>b.id===id)?.name??"?"):null;

  const nameQ=form.name.trim().toLowerCase();
  const matches=!item&&nameQ.length>=2?allItems.filter(i=>i.name.toLowerCase().includes(nameQ)):[];
  const matchGroups=matches.reduce((acc,i)=>{const k=i.name.toLowerCase();if(!acc[k])acc[k]=[];acc[k].push(i);return acc;},{});

  function applyExisting(ex){
    setForm(f=>({...f,name:ex.name,qty:ex.qty,unit:ex.unit,shelf_days:ex.shelf_days,
      freezer_id:ex.freezer_id,bag_id:ex.bag_id,category:ex.category||CATEGORIES[0],
      date_added:new Date().toISOString().slice(0,10),pieces:1}));
    setShowSugg(false);
  }

  function adjustExisting(ex,delta){
    onSave({...ex,pieces:Math.max(0,ex.pieces+delta)});
  }

  return(<>
    <BottomSheet onClose={onClose} title={item?"Product bewerken":"Nieuw product"}>
      {/* Name + barcode */}
      <div className="field" style={{position:"relative"}}>
        <label className="lbl">Naam</label>
        <input className="inp" placeholder="bv. Kipfilet, Pasta, Soep…"
          value={form.name} autoComplete="off"
          onChange={e=>{set("name",e.target.value);setShowSugg(true);}}
          onFocus={()=>setShowSugg(true)}/>
        <div className="field" style={{marginTop:8}}>
          <label className="lbl">Barcode opzoeken</label>
          <BarcodeInput scanLoading={scanLoading} onLookup={async(code)=>{
            setScanLoading(true);
            await lookupBarcode(code, set);
            setScanLoading(false);
          }}/>
        </div>
        {!item&&showSugg&&matches.length>0&&(
          <div className="suggest-box">
            <div className="suggest-hdr">Al in voorraad:<button className="suggest-close" onClick={()=>setShowSugg(false)}>✕</button></div>
            {Object.entries(matchGroups).map(([key,group])=>(
              <div key={key} className="suggest-group">
                <div className="suggest-name">{group[0].name}</div>
                {group.map(ex=>{
                  const days=daysLeft(ex.date_added,ex.shelf_days);
                  return(
                    <div key={ex.id} className="suggest-item">
                      <div className="suggest-meta">🧊 {freezerName(ex.freezer_id)}{bagName(ex.bag_id)?` · 📦 ${bagName(ex.bag_id)}`:""} · <StatusPill days={days}/> · 📅 {new Date(ex.date_added).toLocaleDateString("nl-BE")}</div>
                      <div className="suggest-actions">
                        <div className="suggest-qty-row">
                          <button className="sq-btn" onClick={()=>adjustExisting(ex,-1)}>−</button>
                          <span className="sq-num">{ex.pieces} st</span>
                          <button className="sq-btn" onClick={()=>adjustExisting(ex,+1)}>+</button>
                        </div>
                        <button className="suggest-new-lot" onClick={()=>applyExisting(ex)}>+ Nieuw lot</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Category */}
      <div className="field">
        <label className="lbl">Categorie</label>
        <select className="sel" value={form.category||CATEGORIES[0]} onChange={e=>set("category",e.target.value)}>
          {CATEGORIES.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Location */}
      <div className="frow2">
        <div className="field">
          <label className="lbl">Locatie</label>
          <select className="sel" value={form.freezer_id} onChange={e=>set("freezer_id",e.target.value)}>
            {freezers.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="lbl">Zak / doos</label>
          <select className="sel" value={form.bag_id??""} onChange={e=>set("bag_id",e.target.value||null)}>
            <option value="">— los —</option>
            {bagsForFreezer.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {/* Qty + unit + pieces */}
      <div className="frow3">
        <div className="field">
          <label className="lbl">Hoeveelh.</label>
          <input className="inp" type="number" min="0" placeholder="500" value={form.qty} onChange={e=>set("qty",e.target.value)}/>
        </div>
        <div className="field">
          <label className="lbl">Eenheid</label>
          <select className="sel" value={form.unit} onChange={e=>set("unit",e.target.value)}>
            {UNIT_OPTIONS.map(u=><option key={u}>{u}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="lbl">Stuks</label>
          <input className="inp" type="number" min="1" value={form.pieces} onChange={e=>set("pieces",Number(e.target.value))}/>
        </div>
      </div>

      {/* Min stock */}
      <div className="frow2">
        <div className="field">
          <label className="lbl">Datum opgeslagen</label>
          <input className="inp" type="date" value={form.date_added} onChange={e=>set("date_added",e.target.value)}/>
        </div>
        <div className="field">
          <label className="lbl">Min. voorraad</label>
          <input className="inp" type="number" min="0" placeholder="bv. 2" value={form.min_pieces??""} onChange={e=>set("min_pieces",e.target.value===""?null:Number(e.target.value))}/>
        </div>
      </div>

      {/* Shelf life */}
      <div className="field">
        <label className="lbl">Houdbaar</label>
        <div className="sgrid">
          {SHELF_OPTIONS.map(o=>(
            <button key={o.days} className={`sopt ${form.shelf_days===o.days?"picked":""}`} onClick={()=>set("shelf_days",o.days)}>{o.label}</button>
          ))}
        </div>
      </div>

      <button className="savebtn" disabled={!form.name.trim()} onClick={()=>{onSave(form);setShowSugg(false);}}>
        {item?"Wijzigingen opslaan":"Opslaan"}
      </button>

      {/* Add to shopping list */}
      {shops.length>0&&(
        <div className="field" style={{marginTop:10}}>
          <label className="lbl">Toevoegen aan boodschappenlijst</label>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {shops.map(s=>(
              <button key={s.id} className="shop-tag-btn" onClick={()=>onAddToList(form,s.id)}>{s.name}</button>
            ))}
          </div>
        </div>
      )}

      {onDelete&&<button className="delbtn-full" onClick={onDelete}>Product verwijderen</button>}
    </BottomSheet>

    
  </>);
}

// ── Simple forms ──────────────────────────────────────────────────
function BagForm({bag,freezers,onSave,onClose}) {
  const [form,setForm]=useState({id:bag.id??null,name:bag.name??"",freezer_id:bag.freezer_id??freezers[0]?.id??""});
  return(
    <BottomSheet onClose={onClose} title={bag.id?"Zak/doos bewerken":"Nieuwe zak / doos"}>
      <div className="field"><label className="lbl">Naam</label><input className="inp" placeholder="bv. Zak vlees augustus…" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
      <div className="field"><label className="lbl">Locatie</label>
        <select className="sel" value={form.freezer_id} onChange={e=>setForm(f=>({...f,freezer_id:e.target.value}))}>
          {freezers.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      <button className="savebtn" disabled={!form.name.trim()} onClick={()=>onSave(form)}>Opslaan</button>
    </BottomSheet>
  );
}

function FreezerForm({freezer,onSave,onClose}) {
  const [name,setName]=useState(freezer.name??"");
  return(
    <BottomSheet onClose={onClose} title={freezer.id?"Locatie bewerken":"Nieuwe locatie"}>
      <div className="field"><label className="lbl">Naam</label><input className="inp" placeholder="bv. Diepvries loods links, Kelder droog rek…" value={name} onChange={e=>setName(e.target.value)}/></div>
      <button className="savebtn" disabled={!name.trim()} onClick={()=>onSave({...freezer,name})}>Opslaan</button>
    </BottomSheet>
  );
}

function ShopForm({shop,onSave,onClose}) {
  const [name,setName]=useState(shop?.name??"");
  return(
    <BottomSheet onClose={onClose} title={shop?.id?"Winkel bewerken":"Nieuwe winkel"}>
      <div className="field"><label className="lbl">Naam</label><input className="inp" placeholder="bv. Colruyt, Lidl, Boer Peeters…" value={name} onChange={e=>setName(e.target.value)}/></div>
      <button className="savebtn" disabled={!name.trim()} onClick={()=>onSave({...(shop??{}),name})}>Opslaan</button>
    </BottomSheet>
  );
}

// ── Verbruik tab ──────────────────────────────────────────────────
function VerbruikTab({items,freezers,bags,shops,log,onConsume,onAddToList}) {
  const [search,setSearch]=useState("");
  const q=search.trim().toLowerCase();
  const fn=id=>freezers.find(f=>f.id===id)?.name??"?";
  const bn=id=>id?(bags.find(b=>b.id===id)?.name??"?"):null;
  const avail=items.filter(i=>i.pieces>0);
  const filtered=q.length>=1?avail.filter(i=>i.name.toLowerCase().includes(q)):null;

  return<>
    <div className="search-wrap">
      <span className="search-icon">🔍</span>
      <input className="search-inp" placeholder="Zoek product…" value={search} onChange={e=>setSearch(e.target.value)}/>
      {search&&<button className="search-clear" onClick={()=>setSearch("")}>✕</button>}
    </div>

    {filtered!==null?(
      filtered.length===0?<div className="empty"><div className="ico">🔎</div>Geen resultaten voor "{search}"</div>:
      <>
        <div className="slbl" style={{marginBottom:12}}>{filtered.length} resultaat{filtered.length!==1?"en":""}</div>
        {filtered.map(item=>(
          <div key={item.id} className="card search-result">
            <div className="cm">
              <div className="cn">{item.name}</div>
              <div className="cmt">🧊 {fn(item.freezer_id)}{bn(item.bag_id)?` · 📦 ${bn(item.bag_id)}`:""} · {item.pieces} st{item.qty?` · ${item.qty}${item.unit}`:""}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
              <button className="cbtn" onClick={()=>onConsume(item)}>✓ Gebruikt</button>
              {shops.length>0&&<ShopAddBtn item={item} shops={shops} onAdd={onAddToList}/>}
            </div>
          </div>
        ))}
      </>
    ):(
      <>
        <div className="slbl" style={{marginBottom:14}}>Vink af wat je gebruikt hebt</div>
        {freezers.map(fz=>{
          const fItems=avail.filter(i=>i.freezer_id===fz.id);
          if(!fItems.length)return null;
          return(
            <div key={fz.id} className="fblock">
              <div className="slbl">🧊 {fz.name}</div>
              {fItems.map(item=>(
                <div key={item.id} className="card">
                  <div className="cm">
                    <div className="cn">{item.name}{item.min_pieces!=null&&item.pieces<=item.min_pieces&&<span className="low-tag">↓ min</span>}</div>
                    <div className="cmt">{bn(item.bag_id)?`📦 ${bn(item.bag_id)} · `:""}{item.pieces} st{item.qty?` · ${item.qty}${item.unit}`:""}</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
                    <button className="cbtn" onClick={()=>onConsume(item)}>✓ Gebruikt</button>
                    {shops.length>0&&<ShopAddBtn item={item} shops={shops} onAdd={onAddToList}/>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        {avail.length===0&&<div className="empty"><div className="ico">📭</div>Niets in voorraad.</div>}
      </>
    )}

    {log.length>0&&<>
      <div className="slbl" style={{marginTop:24}}>Geschiedenis</div>
      {log.map(e=>(
        <div key={e.id} className="lentry">
          <div><div className="lname">{e.item_name}</div><div className="lmeta">{fn(e.freezer_id)}{e.bag_id?` · ${bn(e.bag_id)}`:""} · {new Date(e.logged_at).toLocaleString("nl-BE",{dateStyle:"short",timeStyle:"short"})}</div></div>
          <div className="lamt">−{e.amount}</div>
        </div>
      ))}
    </>}
  </>;
}

// ── Shop add button ───────────────────────────────────────────────
function ShopAddBtn({item,shops,onAdd}) {
  const [open,setOpen]=useState(false);
  return(
    <div style={{position:"relative"}}>
      <button className="shop-mini-btn" onClick={()=>setOpen(o=>!o)}>+ lijst</button>
      {open&&(
        <div className="shop-popup">
          {shops.map(s=><button key={s.id} className="shop-popup-opt" onClick={()=>{onAdd(item,s.id);setOpen(false);}}>{s.name}</button>)}
          <button className="shop-popup-cancel" onClick={()=>setOpen(false)}>Annuleren</button>
        </div>
      )}
    </div>
  );
}

// ── Shopping lists tab ────────────────────────────────────────────
function ShoppingTab({shops,listItems,onToggle,onRemove,onAddItem,onAddShop,onEditShop,onDeleteShop,allItems}) {
  const [activeShop,setActiveShop]=useState(shops[0]?.id??null);
  const [search,setSearch]=useState("");
  const [scanLoading,setScanLoading]=useState(false);
  const [showAddForm,setShowAddForm]=useState(false);
  const [newItem,setNewItem]=useState({name:"",qty:"1",unit:"stuks"});

  useEffect(()=>{if(shops.length&&!activeShop)setActiveShop(shops[0].id);},[shops,activeShop]);

  const shopItems=listItems.filter(i=>i.shop_id===activeShop);
  const done=shopItems.filter(i=>i.done);
  const todo=shopItems.filter(i=>!i.done);

  // Suggestions from existing inventory
  const q=search.trim().toLowerCase();
  const suggestions=q.length>=1
    ? [...new Map(allItems.filter(i=>i.name.toLowerCase().includes(q)).map(i=>[i.name.toLowerCase(),i])).values()]
    : [];

  function addFromSuggestion(item){
    onAddItem(activeShop, item.name, item.qty||"1", item.unit||"stuks");
    setSearch(""); 
  }

  function addManual(){
    if(!newItem.name.trim()) return;
    onAddItem(activeShop, newItem.name.trim(), newItem.qty, newItem.unit);
    setNewItem({name:"",qty:"1",unit:"stuks"});
    setShowAddForm(false);
    setSearch("");
  }

  if(!shops.length) return(
    <div className="empty">
      <div className="ico">🛒</div>
      <div>Nog geen winkels aangemaakt.</div>
      <button className="add-btn" style={{marginTop:16,maxWidth:200}} onClick={onAddShop}>+ Winkel toevoegen</button>
    </div>
  );

  return<>
    <div className="shop-tabs-row">
      {shops.map(s=>(
        <button key={s.id} className={`shop-tab ${activeShop===s.id?"on":""}`} onClick={()=>setActiveShop(s.id)}>{s.name}</button>
      ))}
      <button className="shop-tab add-shop-tab" onClick={onAddShop}>+</button>
    </div>

    {activeShop&&<div className="shop-actions-row">
      <button className="s-edit" onClick={()=>onEditShop(shops.find(s=>s.id===activeShop))}>✏ Hernoemen</button>
      <button className="s-del" onClick={()=>onDeleteShop(activeShop)}>🗑 Wis winkel</button>
    </div>}

    {/* Search + add bar */}
    <div className="list-add-section">
      <div style={{position:"relative"}}>
        <div className="search-wrap" style={{marginBottom:suggestions.length>0||showAddForm?8:0}}>
          <span className="search-icon">🔍</span>
          <input className="search-inp" placeholder="Zoek of typ nieuw product…"
            value={search} onChange={e=>{setSearch(e.target.value);setShowAddForm(false);}}
            onFocus={()=>setShowAddForm(false)}/>
          {search&&<button className="search-clear" onClick={()=>setSearch("")}>✕</button>}
        </div>

        {/* Barcode lookup for list */}
        <div style={{marginBottom:12}}>
          <BarcodeInput scanLoading={scanLoading} onLookup={async(code)=>{
            setScanLoading(true);
            const found={};
            await lookupBarcode(code, (k,v)=>{ found[k]=v; });
            setScanLoading(false);
            if(found.name){ onAddItem(activeShop, found.name, "1", "stuks"); }
            else { setSearch(code); }
          }}/>
        </div>

        {/* Suggestions dropdown */}
        {suggestions.length>0&&(
          <div className="suggest-box" style={{position:"relative",marginBottom:10}}>
            <div className="suggest-hdr">Uit voorraad:<button className="suggest-close" onClick={()=>setSearch("")}>✕</button></div>
            {suggestions.slice(0,6).map(item=>(
              <div key={item.id} className="suggest-item" style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600}}>{item.name}</div>
                  <div style={{fontSize:11,color:"var(--muted)"}}>{item.category||""}</div>
                </div>
                <button className="suggest-new-lot" onClick={()=>addFromSuggestion(item)}>+ Voeg toe</button>
              </div>
            ))}
            <div className="suggest-item">
              <button className="suggest-new-lot" style={{width:"100%",textAlign:"center"}}
                onClick={()=>{setNewItem(n=>({...n,name:search}));setShowAddForm(true);setSearch("");}}>
                + Nieuw: "{search}"
              </button>
            </div>
          </div>
        )}

        {/* Quick add when no suggestions */}
        {search.length>=1&&suggestions.length===0&&(
          <button className="list-quick-add" onClick={()=>{setNewItem(n=>({...n,name:search}));setShowAddForm(true);setSearch("");}}>
            + Toevoegen: "{search}"
          </button>
        )}
      </div>

      {/* Manual add form */}
      {showAddForm&&(
        <div className="list-add-form">
          <div className="frow2" style={{marginBottom:8}}>
            <div className="field" style={{marginBottom:0}}>
              <label className="lbl">Naam</label>
              <input className="inp" value={newItem.name} onChange={e=>setNewItem(n=>({...n,name:e.target.value}))} placeholder="Product naam"/>
            </div>
            <div className="field" style={{marginBottom:0}}>
              <label className="lbl">Hoeveelheid</label>
              <input className="inp" type="number" min="0" step="0.1" value={newItem.qty} onChange={e=>setNewItem(n=>({...n,qty:e.target.value}))}/>
            </div>
          </div>
          <div className="field" style={{marginBottom:8}}>
            <label className="lbl">Eenheid</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {UNIT_OPTIONS.map(u=>(
                <button key={u} className={`sopt ${newItem.unit===u?"picked":""}`} style={{padding:"6px 10px",fontSize:12}}
                  onClick={()=>setNewItem(n=>({...n,unit:u}))}>{u}</button>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="savebtn" style={{flex:1,padding:"10px"}} disabled={!newItem.name.trim()} onClick={addManual}>Toevoegen</button>
            <button className="cancbtn" style={{flex:0,padding:"10px 14px",borderRadius:10}} onClick={()=>setShowAddForm(false)}>✕</button>
          </div>
        </div>
      )}
    </div>

    {/* Todo items */}
    {todo.length===0&&done.length===0&&<div className="empty" style={{padding:"20px 0"}}><div className="ico">✅</div>Lijst is leeg.</div>}
    {todo.map(i=>(
      <div key={i.id} className="list-item">
        <button className="list-check" onClick={()=>onToggle(i)}>○</button>
        <div className="list-name">
          {i.name}
          {(i.qty&&i.qty!=="1")||i.unit?<span className="list-qty"> · {i.qty} {i.unit}</span>:""}
        </div>
        <button className="list-del" onClick={()=>onRemove(i.id)}>✕</button>
      </div>
    ))}
    {done.length>0&&<>
      <div className="slbl" style={{marginTop:16}}>Afgevinkt</div>
      {done.map(i=>(
        <div key={i.id} className="list-item done">
          <button className="list-check checked" onClick={()=>onToggle(i)}>✓</button>
          <div className="list-name">{i.name}{i.qty&&i.qty!=="1"?<span className="list-qty"> · {i.qty} {i.unit}</span>:""}</div>
          <button className="list-del" onClick={()=>onRemove(i.id)}>✕</button>
        </div>
      ))}
    </>}
  </>;
}

// ── Settings tab ──────────────────────────────────────────────────
function SettingsTab({freezers,bags,shops,items,listItems,onEditFreezer,onDeleteFreezer,onAddFreezer,onEditBag,onDeleteBag,onEditShop,onDeleteShop,onAddShop,onImport}) {

  function doExport(XL) {
    const wb=XL.utils.book_new();
    const ws=XL.utils.json_to_sheet(items.map(i=>({
      id:i.id, naam:i.name, categorie:i.category||"", locatie_id:i.freezer_id,
      zak_id:i.bag_id||"", stuks:i.pieces, hoeveelheid:i.qty||"", eenheid:i.unit,
      datum_opgeslagen:i.date_added, houdbaar_dagen:i.shelf_days,
      min_stuks:i.min_pieces??"", barcode:i.barcode||""
    })));
    XL.utils.book_append_sheet(wb,ws,"Producten");
    const wsFz=XL.utils.json_to_sheet(freezers.map(f=>({id:f.id,naam:f.name})));
    XL.utils.book_append_sheet(wb,wsFz,"Locaties");
    const wsBg=XL.utils.json_to_sheet(bags.map(b=>({id:b.id,naam:b.name,locatie_id:b.freezer_id})));
    XL.utils.book_append_sheet(wb,wsBg,"Zakken");
    const wbout=XL.write(wb,{bookType:"xlsx",type:"array"});
    const blob=new Blob([wbout],{type:"application/octet-stream"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download="FoodStore_backup.xlsx";
    document.body.appendChild(a); a.click();
    setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},200);
  }

  function exportXLSX() {
    if(window.XLSX){doExport(window.XLSX);return;}
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload=()=>doExport(window.XLSX);
    s.onerror=()=>alert("Kon Excel library niet laden. Probeer opnieuw.");
    document.head.appendChild(s);
  }

  function handleImport(e) {
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=evt=>{
      function doRead(XL){
        const wb=XL.read(evt.target.result,{type:"binary"});
        const rows=XL.utils.sheet_to_json(wb.Sheets["Producten"]||wb.Sheets[wb.SheetNames[0]]);
        onImport(rows);
      }
      if(window.XLSX){doRead(window.XLSX);return;}
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload=()=>doRead(window.XLSX);
      document.head.appendChild(s);
    };
    reader.readAsBinaryString(file);
    e.target.value="";
  }

  return<>
    {/* Excel */}
    <div className="slbl">Excel backup</div>
    <div className="setting-card">
      <div className="setting-desc">Exporteer alle producten naar Excel voor backup of om in bulk aan te passen. Importeer daarna het gewijzigde bestand terug.</div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button className="action-btn export" onClick={exportXLSX}>⬇ Exporteren</button>
        <label className="action-btn import">
          ⬆ Importeren
          <input type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleImport}/>
        </label>
      </div>
    </div>

    {/* Locations */}
    <div className="slbl" style={{marginTop:24}}>Locaties (vriezers / kasten / rekken)</div>
    {freezers.map(fz=>(
      <div key={fz.id} className="setting-row">
        <span className="setting-name">🧊 {fz.name}</span>
        <div className="setting-btns">
          <button className="s-edit" onClick={()=>onEditFreezer(fz)}>✏</button>
          <button className="s-del" onClick={()=>onDeleteFreezer(fz.id)}>🗑</button>
        </div>
      </div>
    ))}
    <button className="add-btn" onClick={onAddFreezer}>+ Locatie toevoegen</button>

    {/* Bags */}
    <div className="slbl" style={{marginTop:24}}>Zakken &amp; dozen</div>
    {bags.length===0&&<div className="empty-small">Nog geen zakken.</div>}
    {bags.map(bag=>(
      <div key={bag.id} className="setting-row">
        <div><div className="setting-name">📦 {bag.name}</div><div className="setting-sub">{freezers.find(f=>f.id===bag.freezer_id)?.name??""}</div></div>
        <div className="setting-btns">
          <button className="s-edit" onClick={()=>onEditBag(bag)}>✏</button>
          <button className="s-del" onClick={()=>onDeleteBag(bag.id)}>🗑</button>
        </div>
      </div>
    ))}

    {/* Shops */}
    <div className="slbl" style={{marginTop:24}}>Winkels</div>
    {shops.length===0&&<div className="empty-small">Nog geen winkels.</div>}
    {shops.map(s=>(
      <div key={s.id} className="setting-row">
        <span className="setting-name">🛒 {s.name}</span>
        <div className="setting-btns">
          <button className="s-edit" onClick={()=>onEditShop(s)}>✏</button>
          <button className="s-del" onClick={()=>onDeleteShop(s.id)}>🗑</button>
        </div>
      </div>
    ))}
    <button className="add-btn" onClick={onAddShop}>+ Winkel toevoegen</button>

        <div className="slbl" style={{marginTop:24}}>Over deze app</div>
        <div className="setting-card">
          <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.9}}>
            <div style={{marginBottom:4}}>📦 <strong style={{color:"var(--text)"}}>Nuyttens Family Food Store</strong></div>
            <div>🗓 Versie: <span style={{color:"var(--cold)"}}>10/05/2025 · 18:30</span></div>
            <div style={{marginTop:10}}>🔗 App link:</div>
            <div style={{marginTop:4,background:"var(--s2)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <span style={{fontSize:11,color:"var(--cold)",wordBreak:"break-all",flex:1}}>{typeof window!=="undefined"?window.location.origin:"—"}</span>
              <button onClick={()=>{if(typeof window!=="undefined")navigator.clipboard.writeText(window.location.origin).then(()=>alert("✓ Link gekopieerd!"));}} style={{flexShrink:0,padding:"5px 10px",background:"var(--accent)",color:"#000",border:"none",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                Kopieer
              </button>
            </div>
            <div style={{fontSize:10,color:"var(--muted)",marginTop:6}}>Open deze link in elke browser of op iPhone om de app te gebruiken.</div>
          </div>
        </div>
  </>;
}

// ── Main App ──────────────────────────────────────────────────────
export default function App() {
  const [freezers,setFreezers]=useState([]);
  const [bags,setBags]=useState([]);
  const [items,setItems]=useState([]);
  const [log,setLog]=useState([]);
  const [shops,setShops]=useState([]);
  const [listItems,setListItems]=useState([]);
  const [loading,setLoading]=useState(true);

  const [tab,setTab]=useState("voorraad");
  const [filterFreezer,setFilterFreezer]=useState("all");
  const [filterCategory,setFilterCategory]=useState("all");
  const [editItem,setEditItem]=useState(null);
  const [editBag,setEditBag]=useState(null);
  const [editFreezer,setEditFreezer]=useState(null);
  const [editShop,setEditShop]=useState(null);
  const [showAddItem,setShowAddItem]=useState(false);
  const [confirmDel,setConfirmDel]=useState(null);

  useEffect(()=>{
    async function load(showLoading=false){
      if(showLoading) setLoading(true);
      const [a,b,c,d,e,f]=await Promise.all([
        supabase.from("freezers").select("*").order("created_at"),
        supabase.from("bags").select("*").order("created_at"),
        supabase.from("items").select("*").order("created_at"),
        supabase.from("consumption_log").select("*").order("logged_at",{ascending:false}).limit(100),
        supabase.from("shops").select("*").order("created_at"),
        supabase.from("shopping_list").select("*").order("created_at"),
      ]);
      if(a.data)setFreezers(a.data);
      if(b.data)setBags(b.data);
      if(c.data)setItems(c.data);
      if(d.data)setLog(d.data);
      if(e.data)setShops(e.data);
      if(f.data)setListItems(f.data);
      if(showLoading) setLoading(false);
    }
    load(true);
    // Realtime via Supabase channels
    const chs=["freezers","bags","items","consumption_log","shops","shopping_list"].map(t=>
      supabase.channel(t).on("postgres_changes",{event:"*",schema:"public",table:t},()=>load()).subscribe()
    );
    // Polling fallback every 10 seconds for cross-device sync
    const poll=setInterval(()=>load(),10000);
    return()=>{chs.forEach(c=>supabase.removeChannel(c));clearInterval(poll);};
  },[]);

  const alerts=useMemo(()=>items.filter(i=>daysLeft(i.date_added,i.shelf_days)<=14&&i.pieces>0),[items]);
  const lowStock=useMemo(()=>items.filter(i=>i.min_pieces!=null&&i.pieces<=i.min_pieces&&i.pieces>0),[items]);
  const fn=id=>freezers.find(f=>f.id===id)?.name??"?";
  const bn=id=>id?(bags.find(b=>b.id===id)?.name??"?"):null;
  const visibleFreezers=filterFreezer==="all"?freezers:freezers.filter(f=>f.id===filterFreezer);

  // ── CRUD — await Supabase, then reload from DB ──
  async function reload(){
    const [a,b,c,d,e,f]=await Promise.all([
      supabase.from("freezers").select("*").order("created_at"),
      supabase.from("bags").select("*").order("created_at"),
      supabase.from("items").select("*").order("created_at"),
      supabase.from("consumption_log").select("*").order("logged_at",{ascending:false}).limit(100),
      supabase.from("shops").select("*").order("created_at"),
      supabase.from("shopping_list").select("*").order("created_at"),
    ]);
    if(a.data)setFreezers(a.data);
    if(b.data)setBags(b.data);
    if(c.data)setItems(c.data);
    if(d.data)setLog(d.data);
    if(e.data)setShops(e.data);
    if(f.data)setListItems(f.data);
  }

  async function saveItem(form){
    const record={...form,id:form.id??uid()};
    setShowAddItem(false);setEditItem(null);
    await supabase.from("items").upsert(record);
    reload();
  }
  async function deleteItem(id){
    setConfirmDel(null);setEditItem(null);
    await supabase.from("items").delete().eq("id",id);
    reload();
  }
  async function saveBag(form){
    const record={...form,id:form.id??uid()};
    setEditBag(null);
    await supabase.from("bags").upsert(record);
    reload();
  }
  async function deleteBag(id){
    setConfirmDel(null);
    await supabase.from("bags").delete().eq("id",id);
    reload();
  }
  async function saveFreezer(form){
    const record={...form,id:form.id??uid()};
    setEditFreezer(null);
    const {data,error}=await supabase.from("freezers").upsert(record).select();
    console.log("saveFreezer result:", JSON.stringify({data,error}));
    if(error){alert("Fout bij opslaan: "+error.message);return;}
    reload();
  }
  async function deleteFreezer(id){
    setConfirmDel(null);
    await supabase.from("freezers").delete().eq("id",id);
    reload();
  }
  async function saveShop(form){
    const record={...form,id:form.id??uid()};
    setEditShop(null);
    await supabase.from("shops").upsert(record);
    reload();
  }
  async function deleteShop(id){
    await supabase.from("shops").delete().eq("id",id);
    reload();
  }
  async function consume(item){
    if(item.pieces<=0)return;
    const entry={id:uid(),item_name:item.name,freezer_id:item.freezer_id,bag_id:item.bag_id,amount:1,logged_at:new Date().toISOString()};
    await supabase.from("items").update({pieces:item.pieces-1}).eq("id",item.id);
    await supabase.from("consumption_log").insert(entry);
    reload();
  }
  async function addToList(item,shopId){
    await supabase.from("shopping_list").insert({id:uid(),shop_id:shopId,name:item.name,qty:item.qty||"",unit:item.unit||"",done:false,created_at:new Date().toISOString()});
    reload();
  }
  async function addToListDirect(shopId,name,qty,unit){
    await supabase.from("shopping_list").insert({id:uid(),shop_id:shopId,name,qty:qty||"",unit:unit||"",done:false,created_at:new Date().toISOString()});
    reload();
  }
  async function toggleListItem(li){
    await supabase.from("shopping_list").update({done:!li.done}).eq("id",li.id);
    reload();
  }
  async function removeListItem(id){
    await supabase.from("shopping_list").delete().eq("id",id);
    reload();
  }
  async function handleImport(rows){
    const records=rows.map(r=>({
      id:r.id||uid(), name:r.naam||r.name||"", category:r.categorie||r.category||CATEGORIES[0],
      freezer_id:r.locatie_id||r.freezer_id||freezers[0]?.id,
      bag_id:r.zak_id||r.bag_id||null,
      pieces:Number(r.stuks||r.pieces||0), qty:r.hoeveelheid||r.qty||"",
      unit:r.eenheid||r.unit||"g", date_added:r.datum_opgeslagen||r.date_added||new Date().toISOString().slice(0,10),
      shelf_days:Number(r.houdbaar_dagen||r.shelf_days||180),
      min_pieces:r.min_stuks!==""&&r.min_stuks!=null?Number(r.min_stuks):null,
      barcode:r.barcode||""
    }));
    await supabase.from("items").upsert(records);
    reload();
  }

  // Grouped view
  const usedCategories=["all",...[...new Set(items.map(i=>i.category||CATEGORIES[0]))]];

  if(loading) return <div style={{background:"#080e1a",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#7dd3fc",fontFamily:"sans-serif",fontSize:14}}>❄ Laden…</div>;

  const badgeCount=alerts.length+lowStock.length;

  return(
    <div className="app">
      <style>{CSS}</style>

      <div className="hdr">
        <div className="hdr-top">
          <div>
            <div className="logo">❄ Nuyttens Family Food Store</div>
            <div className="logo-sub">{freezers.length} locaties · {items.length} producten</div>
          </div>
          {badgeCount>0&&<div className="abadge" onClick={()=>setTab("alerts")}>⚠ {badgeCount}</div>}
        </div>
        <div className="tabs">
          {[["voorraad","📦"],["verbruik","✓"],["boodschappen",`🛒${listItems.filter(i=>!i.done).length>0?` (${listItems.filter(i=>!i.done).length})`:""}`],["alerts",`⚠${badgeCount>0?` (${badgeCount})`:""}`],["instellingen","⚙"]].map(([k,l])=>(
            <button key={k} className={`tb ${tab===k?"on":""}`} onClick={()=>setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="cnt">

        {/* VOORRAAD */}
        {tab==="voorraad"&&<>
          <div className="stats">
            <div className="stat"><div className="stat-n">{items.length}</div><div className="stat-l">Producten</div></div>
            <div className="stat"><div className="stat-n">{items.reduce((s,i)=>s+i.pieces,0)}</div><div className="stat-l">Stuks</div></div>
            <div className="stat"><div className="stat-n" style={{color:badgeCount?"var(--warn)":"var(--ok)"}}>{badgeCount}</div><div className="stat-l">Alerts</div></div>
          </div>

          <div className="frow">
            <button className={`fbtn ${filterFreezer==="all"?"on":""}`} onClick={()=>setFilterFreezer("all")}>Alle</button>
            {freezers.map(f=><button key={f.id} className={`fbtn ${filterFreezer===f.id?"on":""}`} onClick={()=>setFilterFreezer(f.id)}>{f.name}</button>)}
          </div>

          {usedCategories.length>2&&<div className="frow" style={{marginTop:-10}}>
            {usedCategories.map(c=><button key={c} className={`fbtn cat ${filterCategory===c?"on":""}`} onClick={()=>setFilterCategory(c)}>{c==="all"?"Alle cat.":c}</button>)}
          </div>}

          {visibleFreezers.map(fz=>{
            const fzBags=bags.filter(b=>b.freezer_id===fz.id);
            const filterItems=i=>i.freezer_id===fz.id&&(filterCategory==="all"||(i.category||CATEGORIES[0])===filterCategory);
            const looseItems=items.filter(i=>filterItems(i)&&!i.bag_id);
            const hasBagItems=fzBags.some(bag=>items.filter(i=>filterItems(i)&&i.bag_id===bag.id).length>0);
            if(!looseItems.length&&!hasBagItems)return null;
            return(
              <div key={fz.id} className="fblock">
                <div className="slbl">🧊 {fz.name}</div>
                {fzBags.map(bag=>{
                  const bagItems=items.filter(i=>filterItems(i)&&i.bag_id===bag.id);
                  if(!bagItems.length)return null;
                  return <BagSection key={bag.id} bag={bag} items={bagItems} onEditBag={()=>setEditBag(bag)} onDeleteBag={()=>setConfirmDel({type:"bag",obj:bag})} onLongPressItem={item=>setEditItem(item)}/>;
                })}
                {looseItems.length>0&&(
                  <div className="bag-block loose">
                    <div className="bag-hdr"><span className="bag-label">📋 Losse producten</span></div>
                    {looseItems.map(item=><ItemCard key={item.id} item={item} onLongPress={()=>setEditItem(item)} freezerName={fn} bagName={bn}/>)}
                  </div>
                )}
                <button className="add-bag-btn" onClick={()=>setEditBag({id:null,name:"",freezer_id:fz.id})}>+ Zak / doos toevoegen</button>
              </div>
            );
          })}
        </>}

        {tab==="verbruik"&&<VerbruikTab items={items} freezers={freezers} bags={bags} shops={shops} log={log} onConsume={consume} onAddToList={addToList}/>}

        {tab==="boodschappen"&&<ShoppingTab shops={shops} listItems={listItems} allItems={items} onToggle={toggleListItem} onRemove={removeListItem} onAddItem={addToListDirect} onAddShop={()=>setEditShop({id:null,name:""})} onEditShop={s=>setEditShop(s)} onDeleteShop={id=>setConfirmDel({type:"shop",obj:{id,name:shops.find(s=>s.id===id)?.name??""}})}/>}

        {/* ALERTS */}
        {tab==="alerts"&&<>
          {lowStock.length>0&&<>
            <div className="slbl">⬇ Onder minimum voorraad</div>
            {lowStock.map(item=>(
              <div key={item.id} className="acard low-card">
                <div className="aname">{item.name}</div>
                <div className="asub">{item.pieces} stuk{item.pieces!==1?"s":""} over (min: {item.min_pieces}) · {fn(item.freezer_id)}</div>
              </div>
            ))}
          </>}
          {alerts.length>0&&<>
            <div className="slbl" style={{marginTop:lowStock.length?16:0}}>⏰ Bijna verlopen</div>
            {alerts.map(item=>{
              const days=daysLeft(item.date_added,item.shelf_days);
              return(
                <div key={item.id} className={`acard ${days<=0?"aexp":""}`}>
                  <div className="aname">{item.name}</div>
                  <div className="asub">{days<=0?"⛔ Verlopen":`⚠ Nog ${days} dag${days===1?"":"en"}`} · {fn(item.freezer_id)}{item.bag_id?` · ${bn(item.bag_id)}`:""} · {item.pieces} st</div>
                </div>
              );
            })}
          </>}
          {!alerts.length&&!lowStock.length&&<div className="empty"><div className="ico">✅</div>Alles in orde.</div>}
        </>}

        {tab==="instellingen"&&<SettingsTab freezers={freezers} bags={bags} shops={shops} items={items} listItems={listItems}
          onEditFreezer={f=>setEditFreezer(f)} onDeleteFreezer={id=>setConfirmDel({type:"freezer",obj:{id,name:freezers.find(f=>f.id===id)?.name??""}})}
          onAddFreezer={()=>setEditFreezer({id:null,name:""})}
          onEditBag={b=>setEditBag(b)} onDeleteBag={id=>setConfirmDel({type:"bag",obj:{id,name:bags.find(b=>b.id===id)?.name??""}})}
          onEditShop={s=>setEditShop(s)} onDeleteShop={id=>setConfirmDel({type:"shop",obj:{id,name:shops.find(s=>s.id===id)?.name??""}})}
          onAddShop={()=>setEditShop({id:null,name:""})}
          onImport={handleImport}
        />}
      </div>

      {(tab==="voorraad"||tab==="verbruik")&&<button className="fab" onClick={()=>setShowAddItem(true)}>+</button>}

      {(showAddItem||editItem)&&<ItemForm item={editItem} freezers={freezers} bags={bags} allItems={items} shops={shops}
        onSave={saveItem} onAddToList={addToList}
        onDelete={editItem?()=>setConfirmDel({type:"item",obj:editItem}):null}
        onClose={()=>{setShowAddItem(false);setEditItem(null);}}/>}
      {editBag&&<BagForm bag={editBag} freezers={freezers} onSave={saveBag} onClose={()=>setEditBag(null)}/>}
      {editFreezer&&<FreezerForm freezer={editFreezer} onSave={saveFreezer} onClose={()=>setEditFreezer(null)}/>}
      {editShop&&<ShopForm shop={editShop} onSave={saveShop} onClose={()=>setEditShop(null)}/>}

      {confirmDel&&(
        <div className="covl">
          <div className="cbox">
            <div className="ctitle">{confirmDel.type==="freezer"?"Locatie wissen?":confirmDel.type==="bag"?"Zak wissen?":confirmDel.type==="shop"?"Winkel wissen?":"Product wissen?"}</div>
            <div className="csub">"{confirmDel.obj.name}"{confirmDel.type==="freezer"?" — alles erin wordt ook gewist.":confirmDel.type==="bag"?" — producten worden losgekoppeld.":""}</div>
            <div className="cbtns">
              <button className="cancbtn" onClick={()=>setConfirmDel(null)}>Annuleren</button>
              <button className="delbtn" onClick={()=>{
                if(confirmDel.type==="item")deleteItem(confirmDel.obj.id);
                else if(confirmDel.type==="bag")deleteBag(confirmDel.obj.id);
                else if(confirmDel.type==="freezer")deleteFreezer(confirmDel.obj.id);
                else if(confirmDel.type==="shop")deleteShop(confirmDel.obj.id);
                setConfirmDel(null);
              }}>Wissen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{--bg:#080e1a;--s1:#0f1824;--s2:#182030;--s3:#1e2a3d;--border:#243044;--text:#ddeaf8;--muted:#5d7593;--accent:#3d8eff;--cold:#7dd3fc;--ok:#4ade80;--warn:#fb923c;--danger:#f87171;--soon:#fbbf24;--log:#c084fc;--low:#e879f9;}
body{background:var(--bg);margin:0;}
.app{font-family:'Space Grotesk',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;max-width:500px;margin:0 auto;padding-bottom:max(env(safe-area-inset-bottom, 0px) + 80px, 100px);}
.hdr{background:var(--s1);border-bottom:1px solid var(--border);padding:18px 20px 0;padding-top:max(env(safe-area-inset-top, 0px) + 18px, 18px);position:sticky;top:0;z-index:20;}
.hdr-top{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.logo{font-family:'Playfair Display',serif;font-size:16px;background:linear-gradient(120deg,var(--cold),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.logo-sub{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;margin-top:2px;}
.abadge{margin-left:auto;background:var(--danger);color:#fff;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;cursor:pointer;animation:blink 2s infinite;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.5}}
.tabs{display:flex;overflow-x:auto;}
.tb{flex-shrink:0;padding:9px 10px;font-size:12px;font-weight:500;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:'Space Grotesk',sans-serif;transition:all .2s;white-space:nowrap;}
.tb.on{color:var(--cold);border-bottom-color:var(--cold);}
.cnt{padding:16px 20px;}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px;}
.stat{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:10px 12px;text-align:center;}
.stat-n{font-family:'Playfair Display',serif;font-size:24px;color:var(--cold);}
.stat-l{font-size:10px;color:var(--muted);margin-top:2px;}
.frow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.fbtn{padding:4px 11px;border-radius:6px;border:1px solid var(--border);background:none;color:var(--muted);font-size:11px;font-family:'Space Grotesk',sans-serif;cursor:pointer;transition:all .15s;white-space:nowrap;}
.fbtn.on{background:var(--accent);color:#000;border-color:var(--accent);}
.fbtn.cat{font-size:10px;padding:3px 8px;}
.slbl{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;display:flex;align-items:center;gap:8px;}
.slbl::after{content:'';flex:1;height:1px;background:var(--border);}
.fblock{margin-bottom:22px;}
.bag-block{background:var(--s2);border:1px solid var(--border);border-radius:12px;margin-bottom:10px;overflow:hidden;}
.bag-block.loose{background:transparent;border-style:dashed;}
.bag-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;}
.bag-label{font-size:13px;font-weight:600;}
.bag-actions{display:flex;align-items:center;gap:6px;}
.bag-toggle{font-size:10px;color:var(--muted);margin-left:4px;}
.bag-empty{font-size:12px;color:var(--muted);padding:8px 14px 12px;}
.add-bag-btn{width:100%;padding:8px;background:none;border:1px dashed var(--border);border-radius:8px;color:var(--muted);font-size:12px;cursor:pointer;font-family:'Space Grotesk',sans-serif;transition:all .15s;margin-top:4px;}
.add-bag-btn:hover{border-color:var(--accent);color:var(--accent);}
.card{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin:6px 10px;display:flex;align-items:center;gap:10px;transition:border-color .2s;user-select:none;cursor:default;}
.bag-block.loose .card{margin:0 0 8px;}
.card:active{opacity:.8;}
.card.c-exp{border-left:3px solid var(--danger);}
.card.c-warn{border-left:3px solid var(--warn);}
.card.c-empty{opacity:.4;}
.card.c-low{border-left:3px solid var(--low);}
.cm{flex:1;min-width:0;}
.cn{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px;}
.cmt{font-size:11px;color:var(--muted);margin-top:2px;}
.low-tag{font-size:9px;background:#e879f922;color:var(--low);border:1px solid var(--low);border-radius:4px;padding:1px 5px;white-space:nowrap;}
.cr{display:flex;flex-direction:column;align-items:flex-end;gap:5px;}
.qnum{font-size:13px;font-weight:600;}
.pill{font-size:10px;font-weight:600;padding:2px 7px;border-radius:5px;}
.pill.exp{background:#f8717122;color:var(--danger);border:1px solid var(--danger);}
.pill.warn{background:#fb923c22;color:var(--warn);border:1px solid var(--warn);}
.pill.soon{background:#fbbf2422;color:var(--soon);border:1px solid var(--soon);}
.pill.ok{background:#4ade8022;color:var(--ok);border:1px solid var(--ok);}
.cbtn{padding:6px 13px;border-radius:7px;background:var(--s2);border:1px solid var(--ok);color:var(--ok);font-size:12px;font-weight:600;cursor:pointer;font-family:'Space Grotesk',sans-serif;transition:all .15s;}
.cbtn:hover{background:var(--ok);color:#000;}
.setting-row{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;}
.setting-name{font-size:13px;font-weight:600;}
.setting-sub{font-size:11px;color:var(--muted);margin-top:2px;}
.setting-btns{display:flex;gap:6px;}
.setting-card{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:8px;}
.setting-desc{font-size:12px;color:var(--muted);line-height:1.5;}
.action-btn{padding:9px 16px;border-radius:8px;font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .15s;}
.action-btn.export{background:var(--ok);color:#000;}
.action-btn.import{background:var(--accent);color:#000;display:inline-block;}
.s-edit,.s-del{width:30px;height:30px;border-radius:7px;border:1px solid var(--border);background:var(--s2);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.s-edit.sm,.s-del.sm{width:24px;height:24px;font-size:12px;}
.s-edit:hover{border-color:var(--accent);}
.s-del:hover{border-color:var(--danger);}
.add-btn{width:100%;padding:10px;background:none;border:1px dashed var(--border);border-radius:9px;color:var(--muted);font-size:13px;cursor:pointer;font-family:'Space Grotesk',sans-serif;margin-top:4px;transition:all .15s;}
.add-btn:hover{border-color:var(--accent);color:var(--accent);}
.empty-small{font-size:12px;color:var(--muted);padding:8px 0 12px;}
.lentry{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;}
.lname{font-size:13px;font-weight:600;}
.lmeta{font-size:11px;color:var(--muted);margin-top:2px;}
.lamt{font-size:13px;color:var(--log);font-weight:600;}
.acard{background:var(--s1);border:1px solid var(--warn);border-radius:12px;padding:14px;margin-bottom:10px;}
.acard.aexp{border-color:var(--danger);}
.acard.low-card{border-color:var(--low);}
.aname{font-size:14px;font-weight:700;margin-bottom:4px;}
.asub{font-size:11px;color:var(--muted);}
.empty{text-align:center;padding:40px 20px;color:var(--muted);font-size:13px;}
.empty .ico{font-size:32px;margin-bottom:10px;}
/* SHOPPING LIST */
.shop-tabs-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.shop-tab{padding:5px 13px;border-radius:7px;border:1px solid var(--border);background:none;color:var(--muted);font-size:12px;cursor:pointer;font-family:'Space Grotesk',sans-serif;transition:all .15s;}
.shop-tab.on{background:var(--accent);color:#000;border-color:var(--accent);}
.add-shop-tab{border-style:dashed;}
.shop-actions-row{display:flex;gap:8px;margin-bottom:14px;}
.list-item{display:flex;align-items:center;gap:10px;background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:7px;}
.list-item.done{opacity:.5;}
.list-check{width:26px;height:26px;border-radius:50%;border:2px solid var(--border);background:none;color:var(--ok);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
.list-check.checked{background:var(--ok);color:#000;border-color:var(--ok);}
.list-name{flex:1;font-size:13px;font-weight:500;}
.list-qty{color:var(--muted);font-size:11px;}
.list-del{background:none;border:none;color:var(--muted);font-size:14px;cursor:pointer;padding:2px 4px;}
.list-del:hover{color:var(--danger);}
/* SHOP BUTTONS */
.shop-tag-btn{padding:6px 12px;border-radius:7px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:12px;cursor:pointer;font-family:'Space Grotesk',sans-serif;transition:all .15s;}
.shop-tag-btn:hover{border-color:var(--accent);color:var(--accent);}
.shop-mini-btn{padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:none;color:var(--muted);font-size:10px;cursor:pointer;font-family:'Space Grotesk',sans-serif;white-space:nowrap;}
.shop-popup{position:absolute;right:0;top:100%;background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:6px;z-index:30;min-width:130px;box-shadow:0 6px 20px rgba(0,0,0,.4);}
.shop-popup-opt{display:block;width:100%;padding:8px 10px;background:none;border:none;color:var(--text);font-size:12px;cursor:pointer;font-family:'Space Grotesk',sans-serif;text-align:left;border-radius:6px;}
.shop-popup-opt:hover{background:var(--s2);}
.shop-popup-cancel{display:block;width:100%;padding:6px 10px;background:none;border:none;color:var(--muted);font-size:11px;cursor:pointer;font-family:'Space Grotesk',sans-serif;text-align:left;margin-top:4px;border-top:1px solid var(--border);}
/* BARCODE */
.scan-btn{padding:0 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:18px;cursor:pointer;height:42px;transition:all .15s;}
.scan-btn:hover{border-color:var(--accent);}
.scan-wrap{border-radius:10px;overflow:hidden;background:#000;margin-bottom:12px;}
.scan-video{width:100%;height:260px;object-fit:cover;display:block;}
.scan-hint{text-align:center;font-size:12px;color:var(--muted);margin-bottom:8px;}
.scan-error{color:var(--danger);font-size:13px;padding:12px;text-align:center;}
/* OVERLAY / SHEET */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:30;display:flex;flex-direction:column;justify-content:flex-end;}
.sheet{background:var(--s1);border-radius:20px 20px 0 0;border:1px solid var(--border);padding:24px 20px 44px;max-height:92vh;overflow-y:auto;animation:sup .25s ease;}
@keyframes sup{from{transform:translateY(100%)}to{transform:translateY(0)}}
.sheet-title{font-family:'Playfair Display',serif;font-size:20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;}
.xbtn{background:var(--s2);border:1px solid var(--border);color:var(--muted);width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;}
.field{margin-bottom:14px;}
.lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px;}
.inp,.sel{width:100%;background:var(--s2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Space Grotesk',sans-serif;font-size:14px;padding:10px 12px;outline:none;transition:border-color .2s;}
.inp:focus,.sel:focus{border-color:var(--accent);}
.sel option{background:var(--s1);}
.frow2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.frow3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
.sgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;}
.sopt{padding:9px 4px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--muted);font-size:12px;font-weight:500;cursor:pointer;text-align:center;transition:all .15s;font-family:'Space Grotesk',sans-serif;}
.sopt.picked{background:var(--accent);color:#000;border-color:var(--accent);}
.savebtn{width:100%;padding:14px;background:linear-gradient(135deg,var(--accent),var(--cold));color:#000;border:none;border-radius:10px;font-family:'Playfair Display',serif;font-size:16px;font-weight:700;cursor:pointer;margin-top:6px;transition:opacity .2s;}
.savebtn:disabled{opacity:.4;cursor:default;}
.savebtn:hover:not(:disabled){opacity:.85;}
.delbtn-full{width:100%;padding:12px;background:none;border:1px solid var(--danger);color:var(--danger);border-radius:10px;font-family:'Space Grotesk',sans-serif;font-size:13px;cursor:pointer;margin-top:8px;}
/* SUGGESTIONS */
.suggest-box{position:absolute;top:100%;left:0;right:0;background:var(--s1);border:1px solid var(--accent);border-radius:12px;z-index:50;margin-top:4px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.5);max-height:300px;overflow-y:auto;}
.suggest-hdr{font-size:11px;color:var(--muted);padding:10px 14px 6px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);}
.suggest-close{background:none;border:none;color:var(--muted);font-size:14px;cursor:pointer;}
.suggest-group{border-bottom:1px solid var(--border);padding:8px 0;}
.suggest-group:last-child{border-bottom:none;}
.suggest-name{font-size:13px;font-weight:700;padding:0 14px 6px;color:var(--text);}
.suggest-item{padding:6px 14px;}
.suggest-meta{font-size:11px;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
.suggest-actions{display:flex;align-items:center;gap:8px;}
.suggest-qty-row{display:flex;align-items:center;gap:5px;}
.sq-btn{width:26px;height:26px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.sq-btn:hover{border-color:var(--accent);color:var(--accent);}
.sq-num{font-size:13px;font-weight:600;min-width:32px;text-align:center;}
.suggest-new-lot{padding:5px 12px;border-radius:7px;border:1px solid var(--cold);background:none;color:var(--cold);font-size:11px;font-weight:600;cursor:pointer;font-family:'Space Grotesk',sans-serif;transition:all .15s;white-space:nowrap;}
.suggest-new-lot:hover{background:var(--cold);color:#000;}
/* SEARCH */
.search-wrap{position:relative;margin-bottom:18px;display:flex;align-items:center;}
.search-icon{position:absolute;left:12px;font-size:14px;pointer-events:none;}
.search-inp{width:100%;background:var(--s1);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:'Space Grotesk',sans-serif;font-size:14px;padding:11px 38px 11px 36px;outline:none;transition:border-color .2s;}
.search-inp:focus{border-color:var(--accent);}
.search-clear{position:absolute;right:10px;background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;padding:4px;}
.search-result{margin-bottom:8px;}
/* CONFIRM */
.covl{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:40;display:flex;align-items:center;justify-content:center;padding:20px;}
.cbox{background:var(--s1);border:1px solid var(--border);border-radius:16px;padding:24px;width:100%;max-width:320px;text-align:center;}
.ctitle{font-size:16px;font-weight:700;margin-bottom:8px;}
.csub{font-size:13px;color:var(--muted);margin-bottom:20px;}
.cbtns{display:flex;gap:10px;}
.cancbtn{flex:1;padding:11px;border-radius:9px;border:1px solid var(--border);background:none;color:var(--muted);font-family:'Space Grotesk',sans-serif;font-size:13px;cursor:pointer;}
.delbtn{flex:1;padding:11px;border-radius:9px;border:none;background:var(--danger);color:#fff;font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;cursor:pointer;}
/* FAB */
.fab{position:fixed;bottom:28px;right:20px;width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,var(--accent),var(--cold));color:#000;border:none;font-size:28px;cursor:pointer;box-shadow:0 4px 22px rgba(61,142,255,.45);transition:transform .15s;z-index:25;display:flex;align-items:center;justify-content:center;}
.fab:hover{transform:scale(1.08);}
/* BARCODE ROW */
.barcode-row{display:flex;gap:6px;align-items:center;}
/* LIST ADD */
.list-add-section{margin-bottom:4px;}
.list-add-form{background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:14px;}
.list-quick-add{width:100%;padding:10px;background:none;border:1px dashed var(--border);border-radius:8px;color:var(--cold);font-size:13px;cursor:pointer;font-family:'Space Grotesk',sans-serif;margin-bottom:12px;transition:all .15s;}
.list-quick-add:hover{border-color:var(--cold);background:var(--s2);}
`;
