// ==========================================
// 3 ESSE - MOTORE LOGICO FATTURAZIONE
// ==========================================

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let UTENTE_CORRENTE = "Sistema";

let fattureCorrenti = [];
let fatturaAttivaIndex = null;
let apertoDaCommessa = false; 
let filtroFattureCorrente = 'Tutte';

let clientiGlobali = [];
let commesseGlobali = [];
let pagamentiGlobali = [];
let logsCorrenti = []; 

const sequenzaStati = ['Da Emettere', 'Emessa / Inviata', 'Pagata'];

function formattaEuro(numero) {
    if (!numero || isNaN(parseFloat(numero))) return '€ 0,00';
    const numFloat = parseFloat(numero);
    const parti = numFloat.toFixed(2).split('.');
    const interi = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'"); 
    const decimali = parti[1] || '00';
    return `€ ${interi},${decimali}`;
}

async function caricaFileSuStorage(file, prefisso) {
    if (!file) return null;
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '');
    const dataOggi = new Date().toISOString().split('T')[0];
    const randomHash = Math.random().toString(36).substring(2, 6);
    const fileName = `\${prefisso}_${dataOggi}_${Date.now()}_${cleanFileName}_${randomHash}`;
    
    const { error } = await supabaseClient.storage.from('contratti_docs').upload(fileName, file, { cacheControl: '3600', upsert: false });
    if (error) { alert("Errore upload: " + error.message); return null; }
    const { data } = supabaseClient.storage.from('contratti_docs').getPublicUrl(fileName);
    return data.publicUrl;
}

// ================= MODIFICA SEGRETA DIARIO =================
function apriModaleModificaLog(idStr) {
    const logId = parseInt(idStr);
    const log = logsCorrenti.find(l => l.id === logId);
    if(!log) return;
    document.getElementById('mod-log-id').value = log.id;
    document.getElementById('mod-log-azione').value = log.azione || '';
    document.getElementById('mod-log-nota').value = log.nota || '';
    
    if (log.created_at) {
        const d = new Date(log.created_at);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        document.getElementById('mod-log-data').value = d.toISOString().slice(0,16);
    }
    document.getElementById('modal-modifica-log').classList.remove('hidden');
}

function chiudiModaleModificaLog() { document.getElementById('modal-modifica-log').classList.add('hidden'); }

async function salvaModificaLog() {
    const id = document.getElementById('mod-log-id').value;
    const nuovaAzione = document.getElementById('mod-log-azione').value;
    const nuovaNota = document.getElementById('mod-log-nota').value;
    const nuovaData = document.getElementById('mod-log-data').value;

    let timestamp = new Date().toISOString();
    if (nuovaData) timestamp = new Date(nuovaData).toISOString();

    const { error } = await supabaseClient.from('commesse_log').update({ azione: nuovaAzione, nota: nuovaNota || null, created_at: timestamp }).eq('id', id);
    if (!error) { chiudiModaleModificaLog(); caricaCronologia(); } else { alert("Errore modifica log: " + error.message); }
}

async function eliminaLog() {
    const id = document.getElementById('mod-log-id').value;
    if (!confirm("ATTENZIONE: Vuoi eliminare definitivamente questa registrazione dal diario?")) return;
    const { error } = await supabaseClient.from('commesse_log').delete().eq('id', id);
    if (!error) { chiudiModaleModificaLog(); caricaCronologia(); } else { alert("Impossibile eliminare: " + error.message); }
}

// ================= INIT E CARICAMENTO FATTURE =================
document.addEventListener('DOMContentLoaded', async () => {
    const nomeUtenteEl = document.getElementById('nome-utente-sidebar');
    if (nomeUtenteEl) UTENTE_CORRENTE = nomeUtenteEl.innerText;

    inizializzaListenersForm(); // Attiva i form subito

    await inizializzaDatiNuovaFattura();
    await caricaPagamentiTendine();
    await caricaFatture();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'new') apriModaleNuovo(urlParams.get('commessa_id'));
    const idToOpen = urlParams.get('id');
    if (idToOpen) {
        apertoDaCommessa = true; document.getElementById('testo-btn-back').innerText = "Torna alla Commessa";
        const index = fattureCorrenti.findIndex(f => String(f.id) === idToOpen);
        if (index !== -1) apriSchedaFattura(index, true);
    }
});

async function inizializzaDatiNuovaFattura() {
    const { data: clienti } = await supabaseClient.from('clienti').select('id, nome_ragione_sociale').order('nome_ragione_sociale');
    if (clienti) clientiGlobali = clienti;
    const { data: commesse } = await supabaseClient.from('commesse').select('id, numero, nome_cantiere, cliente_id').order('created_at', { ascending: false });
    if (commesse) commesseGlobali = commesse;
}

async function caricaPagamentiTendine() {
    const { data } = await supabaseClient.from('condizioni_pagamento').select('nome').order('nome');
    const selNuovo = document.getElementById('nuovo-pagamento'); const selMod = document.getElementById('mod-pagamento');
    selNuovo.innerHTML = '<option value="">Nessuna (Da definire)</option>'; selMod.innerHTML = '<option value="">Nessuna (Da definire)</option>';
    if (data) { pagamentiGlobali = data; data.forEach(p => { selNuovo.innerHTML += `<option value="${p.nome}">${p.nome}</option>`; selMod.innerHTML += `<option value="${p.nome}">${p.nome}</option>`; }); }
}

async function caricaFatture() {
    const tbody = document.getElementById('tabella-fatture');
    
    // Fallback Manuale incrociando i dati per evitare errori Supabase
    const { data: rawFats, error: err2 } = await supabaseClient.from('fatture').select('*').order('created_at', { ascending: false });
    if (err2) { tbody.innerHTML = '<tr><td colspan="6" class="text-center text-red-500 py-4 font-bold">Errore DB Server.</td></tr>'; return; }
    
    const { data: rawComms } = await supabaseClient.from('commesse').select('id, numero, nome_cantiere, cliente_id');
    const { data: rawClienti } = await supabaseClient.from('clienti').select('id, nome_ragione_sociale');
    
    let fats = (rawFats || []).map(f => {
        if (rawComms) {
            let relCom = rawComms.find(c => String(c.id) === String(f.commessa_id));
            if (relCom) {
                if (rawClienti) {
                    relCom.clienti = rawClienti.find(cl => String(cl.id) === String(relCom.cliente_id));
                }
                f.commesse = relCom;
            }
        }
        return f;
    });

    fattureCorrenti = fats || []; 
    document.getElementById('conteggio-fatture').innerText = `\${fattureCorrenti.length} pratiche registrate`;
    aggiornaStileTabsFatture(); 
    aggiornaVistaFatture();
}

function aggiornaStileTabsFatture() {
    const tabs = [ { id: 'Tutte', label: 'Registro Completo' }, { id: 'Da Emettere', label: 'Da Emettere / Richieste' }, { id: 'Emessa / Inviata', label: 'Emesse (In attesa)' }, { id: 'Pagata', label: 'Pagate / Incassate' } ];
    let counts = { 'Tutte': fattureCorrenti.length, 'Da Emettere': 0, 'Emessa / Inviata': 0, 'Pagata': 0 };
    fattureCorrenti.forEach(f => { let s = f.stato || 'Da Emettere'; if(s === 'Inviata' || s === 'Emessa') s = 'Emessa / Inviata'; f.statoPulito = s; if(counts[s] !== undefined) counts[s]++; });
    tabs.forEach(t => {
        const cleanId = t.id.replace(/ /g, '').replace(/\//g, ''); const btn = document.getElementById('tab-fat-' + cleanId);
        if (btn) { btn.innerHTML = `\${t.label} <span class="ml-1 opacity-80">(\${counts[t.id]})</span>`;
            if (t.id === filtroFattureCorrente) btn.className = "px-4 py-2 text-sm font-bold text-white bg-[#2e2a5b] rounded-lg shadow-sm transition-colors whitespace-nowrap flex items-center";
            else btn.className = "px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg transition-colors whitespace-nowrap flex items-center";
        }
    });
}

function cambiaTabFatture(tab) { filtroFattureCorrente = tab; aggiornaStileTabsFatture(); aggiornaVistaFatture(); }

function aggiornaVistaFatture() {
    const query = document.getElementById('input-ricerca').value.toLowerCase();
    const filtrati = fattureCorrenti.filter(f => {
        const nomeCliente = (f.commesse && f.commesse.clienti && f.commesse.clienti.nome_ragione_sociale) ? String(f.commesse.clienti.nome_ragione_sociale).toLowerCase() : '';
        const numCommessa = (f.commesse && f.commesse.numero) ? String(f.commesse.numero).toLowerCase() : '';
        const numFattura = (f.numero) ? String(f.numero).toLowerCase() : '';
        
        const matchTesto = nomeCliente.includes(query) || numCommessa.includes(query) || numFattura.includes(query);
        const matchTab = (filtroFattureCorrente === 'Tutte') || (f.statoPulito === filtroFattureCorrente);
        return matchTesto && matchTab;
    });
    disegnaTabella(filtrati);
}

function filtraFatture() { aggiornaVistaFatture(); }

function disegnaTabella(lista) {
    const tbody = document.getElementById('tabella-fatture'); tbody.innerHTML = '';
    if (lista.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">Nessuna fattura o acconto trovato.</td></tr>'; return; }
    lista.forEach(f => {
        const realIndex = fattureCorrenti.indexOf(f);
        const tr = document.createElement('tr'); tr.className = 'hover:bg-gray-50 transition-colors cursor-pointer'; tr.onclick = () => apriSchedaFattura(realIndex);
        
        const cantiere = f.commesse ? `${f.commesse.numero}${f.commesse.nome_cantiere ? '('+f.commesse.nome_cantiere+')' : ''}` : '--';
        const cliente = (f.commesse && f.commesse.clienti && f.commesse.clienti.nome_ragione_sociale) ? f.commesse.clienti.nome_ragione_sociale : '--';
        const importo = f.importo ? `€ \${parseFloat(f.importo).toFixed(2).replace('.', ',')}` : '--';
        const dataCreazione = f.created_at ? new Date(f.created_at).toLocaleDateString('it-IT') : '--';
        
        let colorStato = 'bg-yellow-100 text-yellow-800'; 
        if(f.statoPulito === 'Emessa / Inviata') colorStato = 'bg-blue-100 text-blue-700';
        if(f.statoPulito === 'Pagata') colorStato = 'bg-emerald-100 text-emerald-800';
        
        tr.innerHTML = `<td class="px-6 py-4 text-gray-900 font-bold">\${cliente}</td><td class="px-6 py-4 text-gray-600 text-xs">\${cantiere}</td><td class="px-6 py-4 font-bold text-[#2e2a5b]">\${f.numero}</td><td class="px-6 py-4 text-gray-500 text-xs">\${dataCreazione}</td><td class="px-6 py-4 text-gray-900 font-bold">\${importo}</td><td class="px-6 py-4"><span class="px-3 py-1 \${colorStato} rounded-full text-[10px] font-bold uppercase tracking-wider">\${f.statoPulito}</span></td>`;
        tbody.appendChild(tr);
    });
}

// ================= SCHEDA FATTURA E LED =================
function apriSchedaFattura(index, fromUrl = false) {
    fatturaAttivaIndex = index; aggiornaDatiSchedaUI(); caricaCronologia();
    document.getElementById('vista-elenco').classList.replace('flex', 'hidden'); document.getElementById('vista-scheda').classList.replace('hidden', 'flex');
    if (!fromUrl) { document.getElementById('testo-btn-back').innerText = "Torna a Elenco"; apertoDaCommessa = false; }
}

function chiudiScheda() {
    if (apertoDaCommessa) { window.location.href = `commesse.html?id=\${fattureCorrenti[fatturaAttivaIndex].commessa_id}`; return; }
    fatturaAttivaIndex = null; document.getElementById('vista-scheda').classList.replace('flex', 'hidden'); document.getElementById('vista-elenco').classList.replace('hidden', 'flex');
    caricaFatture();
}

function aggiornaDatiSchedaUI() {
    const f = fattureCorrenti[fatturaAttivaIndex]; document.getElementById('scheda-titolo').innerText = f.numero;
    const cantiere = f.commesse ? `${f.commesse.numero}${f.commesse.nome_cantiere ? '('+f.commesse.nome_cantiere+')' : ''}` : '--';
    const cliente = (f.commesse && f.commesse.clienti && f.commesse.clienti.nome_ragione_sociale) ? f.commesse.clienti.nome_ragione_sociale : '--';
    const importo = f.importo ? `€ \${parseFloat(f.importo).toFixed(2).replace('.', ',')}` : '0,00 €';
    
    document.getElementById('scheda-sottotitolo-commessa').innerText = cantiere; document.getElementById('scheda-sottotitolo-cliente').innerText = cliente; document.getElementById('scheda-sottotitolo-valore').innerText = importo; document.getElementById('scheda-sottotitolo-condizione').innerText = f.condizione_pagamento || 'N/D';
    
    let statoPuro = f.statoPulito || 'Da Emettere';
    let colorStato = 'bg-yellow-100 text-yellow-800'; if(statoPuro === 'Emessa / Inviata') colorStato = 'bg-blue-100 text-blue-700'; if(statoPuro === 'Pagata') colorStato = 'bg-emerald-100 text-emerald-800';
    
    document.getElementById('scheda-badge-stato').innerText = statoPuro; document.getElementById('scheda-badge-stato').className = `px-3 py-1 \${colorStato} rounded-full text-xs font-bold uppercase tracking-wider`;
    document.getElementById('data-nota-libera').value = new Date().toISOString().split('T')[0];

    disegnaStepper(statoPuro); disegnaStoricoFile(f.file_url);
}

function disegnaStoricoFile(urls_csv) {
    const div = document.getElementById('lista-file-fattura');
    if(!urls_csv || urls_csv.trim() === '') { div.innerHTML = '<p class="text-sm text-gray-500 italic">Nessun documento caricato nello storico.</p>'; return; }
    const urls = urls_csv.split(',').filter(x => x.trim() !== ''); let html = '';
    urls.forEach((url, i) => {
        let nameVisuale = `Documento \${i+1}`; let colorBox = (i === urls.length - 1) ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'; let iconaColor = (i === urls.length - 1) ? 'text-emerald-600' : 'text-gray-500';
        html += `<a href="\${url.trim()}" target="_blank" class="flex items-center gap-3 p-3 rounded-lg border \${colorBox} hover:shadow-md transition-shadow group"><div class="text-2xl \${iconaColor} group-hover:scale-110 transition-transform">📄</div><div class="flex-1"><p class="text-sm font-bold text-gray-900">\${nameVisuale}</p><p class="text-[10px] text-gray-500">Clicca per aprire</p></div><div class="text-gray-400 font-bold">&rarr;</div></a>`;
    }); div.innerHTML = html;
}

function disegnaStepper(statoAttuale) {
    const container = document.getElementById('stepper-container'); const azioniBox = document.getElementById('stepper-azioni'); container.innerHTML = ''; azioniBox.innerHTML = '';
    let idxCalcolato = sequenzaStati.indexOf(statoAttuale); if (idxCalcolato === -1) idxCalcolato = 0;
    const bgLine = document.createElement('div'); bgLine.className = 'absolute top-1/2 left-0 w-full h-1 bg-gray-200 -z-10 -translate-y-1/2 rounded-full'; container.appendChild(bgLine);
    sequenzaStati.forEach((stato, index) => {
        const punto = document.createElement('div'); punto.className = 'flex flex-col items-center gap-2 bg-white px-2 sm:px-4 z-10 cursor-pointer hover:scale-110 transition-transform'; punto.onclick = () => saltoStato(stato); 
        let iconaHTML = `<div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-gray-100 text-gray-400 border-2 border-gray-200">\${index + 1}</div>`;
        if (index < idxCalcolato || (idxCalcolato === sequenzaStati.length -1 && index === idxCalcolato)) { iconaHTML = `<div class="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-500 text-white shadow-md">✓</div>`; } else if (index === idxCalcolato) { iconaHTML = `<div class="w-8 h-8 rounded-full flex items-center justify-center bg-blue-500 ring-blue-100 text-white font-bold text-sm shadow-lg ring-4">\${index + 1}</div>`; }
        let textColor = (index <= idxCalcolato || idxCalcolato === sequenzaStati.length -1) ? 'text-gray-900 font-bold' : 'text-gray-400';
        punto.innerHTML = `
            \${iconaHTML}
            <span class="text-[9px] sm:text-xs uppercase tracking-wider text-center w-20 leading-tight ${textColor}">${stato}</span>
        `;
        container.appendChild(punto);
    });
    if (statoAttuale === 'Da Emettere') { azioniBox.innerHTML = `<button onclick="preparaAzione('Emessa / Inviata', false)" class="text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 px-8 py-2.5 rounded-lg shadow-sm">Segna come Emessa / Inviata &rarr;</button>`; } else if (statoAttuale === 'Emessa / Inviata') { azioniBox.innerHTML = `<button onclick="preparaAzione('Da Emettere', false)" class="text-sm font-medium text-gray-600 bg-white border border-gray-300 px-4 py-2 rounded-lg">&larr; Annulla Emissione</button><div class="flex-1"></div><button onclick="preparaAzione('Pagata', false)" class="text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-8 py-2.5 rounded-lg shadow-md">✅ Registra Incasso Effettuato</button>`; } else if (statoAttuale === 'Pagata') { azioniBox.innerHTML = `<button onclick="preparaAzione('Emessa / Inviata', false)" class="text-sm font-medium text-gray-600 bg-white border border-gray-300 px-4 py-2 rounded-lg">&larr; Rimuovi Pagamento (Torna a Emessa)</button>`; }
}

function saltoStato(nuovoStato) {
    let statoPuro = fattureCorrenti[fatturaAttivaIndex].stato || 'Da Emettere'; if(statoPuro === 'Inviata' || statoPuro === 'Emessa') statoPuro = 'Emessa / Inviata';
    if (statoPuro === nuovoStato) return; if (confirm(`Vuoi forzare lo stato fatturazione a: \${nuovoStato.toUpperCase()}?`)) { preparaAzione(nuovoStato, true); }
}

function preparaAzione(nuovoStato, isJump = false) {
    document.getElementById('azione-target-stato').value = nuovoStato; document.getElementById('azione-is-jump').value = isJump ? 'SI' : 'NO'; document.getElementById('azione-data').value = new Date().toISOString().split('T')[0]; document.getElementById('azione-note').value = ''; document.getElementById('azione-file').value = '';
    const titolo = document.getElementById('modale-azione-titolo'); const sub = document.getElementById('modale-azione-sub'); const labelData = document.getElementById('label-data'); const labelFile = document.getElementById('label-file');
    if (nuovoStato === 'Emessa / Inviata') { titolo.innerText = "Emissione Fattura / Richiesta"; sub.innerText = "La richiesta è stata inoltrata formalmente."; labelData.innerText = "📅 Data Emissione"; labelFile.innerText = "Allega PDF Fattura di Cortesia (Opzionale)"; } else if (nuovoStato === 'Pagata') { titolo.innerText = "Registra Incasso"; sub.innerText = "Il cliente ha saldato questo importo."; labelData.innerText = "📅 Data Valuta Bonifico / Incasso"; labelFile.innerText = "Allega Contabile Bonifico (Opzionale)"; } else { titolo.innerText = `Aggiorna a: \${nuovoStato.toUpperCase()}`; sub.innerText = "Ritorno a stato precedente"; labelData.innerText = "📅 Data operazione"; labelFile.innerText = "Allega Documento (Opzionale)"; }
    document.getElementById('modal-azione').classList.remove('hidden');
}

function chiudiModaleAzione() { document.getElementById('modal-azione').classList.add('hidden'); }

async function eseguiAzione() {
    const btn = document.getElementById('btn-conferma-azione'); const f = fattureCorrenti[fatturaAttivaIndex];
    const nuovoStato = document.getElementById('azione-target-stato').value; const dataAzione = document.getElementById('azione-data').value; const note = document.getElementById('azione-note').value; const fileInput = document.getElementById('azione-file');
    btn.innerText = "Salvataggio..."; btn.disabled = true;

    let timestampFormattato = new Date().toISOString(); const dataOggi = new Date().toISOString().split('T')[0];
    if (dataAzione && dataAzione !== dataOggi) { timestampFormattato = new Date(`\${dataAzione}T12:00:00Z`).toISOString(); }

    let fileUrl = null; if (fileInput.files.length > 0) { btn.innerText = "Caricamento File..."; fileUrl = await caricaFileSuStorage(fileInput.files[0], 'FATT'); }
    let datiAggiornamento = { stato: nuovoStato }; if (fileUrl) { let urlCorrente = f.file_url || ''; datiAggiornamento.file_url = urlCorrente ? urlCorrente + ',' + fileUrl : fileUrl; }
    
    const { error } = await supabaseClient.from('fatture').update(datiAggiornamento).eq('id', f.id);
    if (!error) {
        f.stato = nuovoStato; if(fileUrl) f.file_url = datiAggiornamento.file_url;
        let testoLog = ``; if(nuovoStato === 'Emessa / Inviata') testoLog = `Inviata richiesta fattura/acconto: ${f.numero}`; else if(nuovoStato === 'Pagata') testoLog = `💰 Incasso registrato per: ${f.numero} (€ ${f.importo})`; else testoLog = `Stato fattura ${f.numero} riportato a: ${nuovoStato}`;
        if(note) testoLog += ` Note: "${note}"`;
        await supabaseClient.from('commesse_log').insert([{ commessa_id: f.commessa_id, azione: testoLog, file_url: fileUrl, autore: UTENTE_CORRENTE, created_at: timestampFormattato }]);
        chiudiModaleAzione(); aggiornaDatiSchedaUI(); caricaCronologia(); caricaFatture(); 
    } else { alert("Errore di sistema: " + error.message); }
    btn.innerText = "Conferma Azione"; btn.disabled = false;
}

// ================= MODIFICA E NUOVA FATTURA =================
function apriModaleNuovo(commessaPreselezionata = null) {
    document.getElementById('form-nuovo').reset();
    const selCliente = document.getElementById('nuovo-cliente'); selCliente.innerHTML = '<option value="">-- Seleziona Cliente --</option>'; clientiGlobali.forEach(c => selCliente.innerHTML += `<option value="${c.id}">${c.nome_ragione_sociale}</option>`);
    const selCommessa = document.getElementById('nuovo-commessa'); selCommessa.innerHTML = '<option value="">-- Seleziona prima un cliente --</option>'; selCommessa.disabled = true; selCommessa.classList.add('bg-gray-50'); selCommessa.classList.remove('bg-white');
    document.getElementById('modal-nuovo').classList.remove('hidden');
    if (commessaPreselezionata) { const comTrovata = commesseGlobali.find(c => String(c.id) === String(commessaPreselezionata)); if (comTrovata) { selCliente.value = comTrovata.cliente_id; filtraCommessePerCliente(); selCommessa.value = comTrovata.id; } }
}

function filtraCommessePerCliente() {
    const clienteId = document.getElementById('nuovo-cliente').value; const selCommessa = document.getElementById('nuovo-commessa'); selCommessa.innerHTML = '<option value="">-- Seleziona Commessa / Cantiere --</option>';
    if (!clienteId) { selCommessa.disabled = true; selCommessa.classList.add('bg-gray-50'); selCommessa.classList.remove('bg-white'); return; }
    selCommessa.disabled = false; selCommessa.classList.remove('bg-gray-50'); selCommessa.classList.add('bg-white');
    const commesseFiltrate = commesseGlobali.filter(c => String(c.cliente_id) === String(clienteId));
    if (commesseFiltrate.length === 0) { selCommessa.innerHTML = '<option value="">Nessuna commessa attiva per questo cliente</option>'; selCommessa.disabled = true; } else { commesseFiltrate.forEach(c => { selCommessa.innerHTML += `<option value="${c.id}">${c.numero} - ${c.nome_cantiere || ''}</option>`; }); }
}

function chiudiModaleNuovo() { document.getElementById('modal-nuovo').classList.add('hidden'); window.history.replaceState({}, document.title, window.location.pathname); }

function apriModaleModificaDatiBase() {
    const f = fattureCorrenti[fatturaAttivaIndex]; document.getElementById('mod-numero').value = f.numero || ''; document.getElementById('mod-importo').value = f.importo || ''; document.getElementById('mod-pagamento').value = f.condizione_pagamento || ''; document.getElementById('modal-modifica-dati').classList.remove('hidden');
}

async function salvaModificaDati() {
    const f = fattureCorrenti[fatturaAttivaIndex]; const nuovoNumero = document.getElementById('mod-numero').value; const nuovoImporto = document.getElementById('mod-importo').value; const nuovoPagamento = document.getElementById('mod-pagamento').value || null;
    const { error } = await supabaseClient.from('fatture').update({ numero: nuovoNumero, importo: nuovoImporto, condizione_pagamento: nuovoPagamento }).eq('id', f.id);
    if (!error) { f.numero = nuovoNumero; f.importo = nuovoImporto; f.condizione_pagamento = nuovoPagamento; await supabaseClient.from('commesse_log').insert([{ commessa_id: f.commessa_id, azione: `Fatturazione corretta in: ${nuovoNumero} (€ ${nuovoImporto})`, autore: UTENTE_CORRENTE }]); document.getElementById('modal-modifica-dati').classList.add('hidden'); aggiornaDatiSchedaUI(); caricaCronologia(); caricaFatture(); }
}

async function confermaEliminazioneFattura() {
    const f = fattureCorrenti[fatturaAttivaIndex]; if(!confirm(`Sei sicuro di voler eliminare definitivamente la fattura/acconto ${f.numero}?`)) return;
    const { error } = await supabaseClient.from('fatture').delete().eq('id', f.id);
    if (!error) { document.getElementById('modal-modifica-dati').classList.add('hidden'); chiudiScheda(); caricaFatture(); } else { alert("Impossibile eliminare: " + error.message); }
}

async function salvaNotaLibera() {
    const inputNota = document.getElementById('input-nota-libera'); const dataNota = document.getElementById('data-nota-libera').value; const testo = inputNota.value; if (!testo || testo.trim() === '') return;
    const comId = fattureCorrenti[fatturaAttivaIndex].commessa_id; let timestamp = new Date().toISOString(); if (dataNota && dataNota !== new Date().toISOString().split('T')[0]) { timestamp = new Date(`${dataNota}T12:00:00Z`).toISOString(); }
    const { error } = await supabaseClient.from('commesse_log').insert([{ commessa_id: comId, azione: "Nota Amministrativa", nota: testo, autore: UTENTE_CORRENTE, created_at: timestamp }]);
    if (!error) { inputNota.value = ''; caricaCronologia(); } 
}

async function caricaCronologia() {
    const comId = fattureCorrenti[fatturaAttivaIndex].commessa_id; const divLog = document.getElementById('lista-cronologia'); divLog.innerHTML = '<p class="text-sm text-gray-500 italic">Caricamento...</p>';
    if (!comId) { divLog.innerHTML = '<p class="text-sm text-gray-500">Nessuna commessa associata a questo incasso.</p>'; return; }
    const { data: logs } = await supabaseClient.from('commesse_log').select('*').eq('commessa_id', comId).or('azione.ilike.%fattur%,azione.ilike.%incasso%,azione.ilike.%acconto%,azione.ilike.%pagament%,azione.ilike.%Nota Amm%').order('created_at', { ascending: false });
    if (!logs || logs.length === 0) { divLog.innerHTML = '<p class="text-sm text-gray-500">Nessuna nota presente.</p>'; return; }
    logsCorrenti = logs; let html = '';
    logs.forEach(log => {
        const dateObj = new Date(log.created_at); const dataFormat = dateObj.toLocaleDateString('it-IT') + ' ' + dateObj.toLocaleTimeString('it-IT', { hour: '2-digit', minute:'2-digit' });
        const notaHtml = log.nota ? `<p class="text-sm text-gray-700 mt-2 bg-gray-50 p-2 rounded-lg border border-gray-100 shadow-inner">"${log.nota}"</p>` : '';
        let icona = '<div class="w-2 h-2 rounded-full bg-[#2e2a5b] mt-1.5 ring-4 ring-indigo-50"></div>'; if(log.azione.includes('Incasso') || log.azione.includes('💰')) icona = '<div class="w-4 h-4 rounded flex items-center justify-center bg-emerald-100 text-emerald-600 text-[10px] ring-2 ring-emerald-50">✅</div>';
        let iconaContainer = `<div class="cursor-pointer hover:scale-125 transition-transform" ondblclick="apriModaleModificaLog('${log.id}')" title="Doppio clic per modificare">${icona}</div>`;
        let pData = `<p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-[#2e2a5b] transition-colors" ondblclick="apriModaleModificaLog('${log.id}')" title="Doppio clic per modificare">${dataFormat}</p>`;
        html += `<div class="flex gap-4 items-start pb-3 border-b border-gray-100 last:border-0">${iconaContainer}<div class="flex-1"><div class="flex justify-between items-center mb-1"><p class="text-xs font-bold text-gray-900">${log.azione}</p>${pData}</div>${notaHtml}</div></div>`;
    });
    divLog.innerHTML = html;
}

// ================= LISTENERS FATTURE =================
function inizializzaListenersForm() {
    const formNuovo = document.getElementById('form-nuovo');
    if (formNuovo) {
        formNuovo.addEventListener('submit', async (e) => {
            e.preventDefault();
            const dati = { commessa_id: document.getElementById('nuovo-commessa').value, numero: document.getElementById('nuovo-numero').value, importo: document.getElementById('nuovo-importo').value, condizione_pagamento: document.getElementById('nuovo-pagamento').value || null, stato: 'Da Emettere' };
            const { error } = await supabaseClient.from('fatture').insert([dati]);
            if (!error) { await supabaseClient.from('commesse_log').insert([{ commessa_id: dati.commessa_id, azione: `Generata nuova richiesta di fatturazione: ${dati.numero} (€ ${dati.importo})`, autore: UTENTE_CORRENTE }]); chiudiModaleNuovo(); caricaFatture(); } else { alert("Errore salvataggio: " + error.message); }
        });
    }
}
