// ==========================================
// 3 ESSE - MOTORE LOGICO COMMESSE SEMPLIFICATO
// ==========================================

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let UTENTE_CORRENTE = "Sistema";

let listaClientiCache = [];
let commesseCorrenti = []; 
let sediGlobali = []; 
let totaleCommesse = 0; 
let logsCorrenti = []; 
let commessaAttivaIndex = null; 

// Struttura fissa della To-Do List
const strutturaToDo = [
    { id: 'prev', label: '1. Preventivo', sub: [
        { idx: 0, label: 'Calcolo' },
        { idx: 1, label: 'Verifica' },
        { idx: 2, label: 'Invio' }
    ]},
    { id: 'ril', label: '2. Rilievo misure', sub: [
        { idx: 3, label: 'Per Preventivo' },
        { idx: 4, label: 'Esecutive' }
    ]},
    { id: 'contr', label: '3. Contratto', sub: [
        { idx: 5, label: 'Ricontrollo da C.O.' },
        { idx: 6, label: 'Verifica' },
        { idx: 7, label: 'Invio al cliente' }
    ]},
    { id: 'pag', label: '4. Pagamenti', sub: [
        { idx: 8, label: 'Acconto' },
        { idx: 9, label: 'Saldo' }
    ]}
];

document.addEventListener('DOMContentLoaded', async () => { 
    const nomeUtenteEl = document.getElementById('nome-utente-sidebar');
    if (nomeUtenteEl) UTENTE_CORRENTE = nomeUtenteEl.innerText;

    inizializzaListeners();

    try {
        await popolaTendinaClienti(); 
        await caricaSediTendina(); 
        await caricaCommesse(); 
    } catch(err) {
        console.error("Errore durante il download dal database:", err);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const idToOpen = urlParams.get('id');
    const action = urlParams.get('action');
    const clienteId = urlParams.get('cliente_id');

    if (action === 'new') {
        apriModaleNuovaCommessa();
        if (clienteId) {
            const select = document.getElementById('form-com-cliente');
            if(select) {
                select.value = clienteId;
                const chk = document.getElementById('check-copia-dati');
                if(chk) chk.checked = true;
                select.dispatchEvent(new Event('change'));
            }
        }
    }

    if (idToOpen) {
        const index = commesseCorrenti.findIndex(c => String(c.id) === idToOpen);
        if (index !== -1) {
            apriSchedaCommessa(index);
        }
    }
});

// ================= GESTIONE LISTA COMMESSE =================
async function popolaTendinaClienti() {
    const { data } = await supabaseClient.from('clienti').select('id, nome_ragione_sociale, indirizzo, citta, telefono, email').order('nome_ragione_sociale');
    if (data) {
        listaClientiCache = data;
        const select = document.getElementById('form-com-cliente');
        if(select) {
            select.innerHTML = '<option value="">-- Seleziona un cliente --</option>';
            data.forEach(c => select.innerHTML += '<option value="' + c.id + '">' + c.nome_ragione_sociale + '</option>');
        }
    }
}

async function caricaSediTendina() {
    const { data } = await supabaseClient.from('sedi_aziendali').select('nome').order('nome');
    if (data) {
        sediGlobali = data;
        const selNuovo = document.getElementById('form-com-sede');
        const selModifica = document.getElementById('mod-com-sede');
        if(selNuovo) selNuovo.innerHTML = '<option value="">-- Seleziona Sede --</option>';
        if(selModifica) selModifica.innerHTML = '<option value="">Nessuna sede specificata</option>';
        data.forEach(s => {
            if(selNuovo) selNuovo.innerHTML += '<option value="' + s.nome + '">' + s.nome + '</option>';
            if(selModifica) selModifica.innerHTML += '<option value="' + s.nome + '">' + s.nome + '</option>';
        });
    }
}

async function caricaCommesse() {
    let { data: commesse, error } = await supabaseClient.from('commesse').select('*, clienti(nome_ragione_sociale)').order('updated_at', { ascending: false, nullsFirst: false }); 
    const tbody = document.getElementById('tabella-commesse');
    
    if (error) { 
        const { data: rawCommesse } = await supabaseClient.from('commesse').select('*').order('created_at', { ascending: false });
        if (!rawCommesse) return;
        const { data: allClienti } = await supabaseClient.from('clienti').select('id, nome_ragione_sociale');
        commesse = rawCommesse.map(com => {
            if (allClienti) com.clienti = allClienti.find(c => String(c.id) === String(com.cliente_id));
            return com;
        });
    }

    commesseCorrenti = commesse || [];
    totaleCommesse = commesseCorrenti.length; 
    const lblCount = document.getElementById('conteggio-commesse');
    if(lblCount) lblCount.innerText = commesseCorrenti.length + ' commesse in corso';
    disegnaListaCommesse(commesseCorrenti);
}

function disegnaListaCommesse(lista) {
    const tbody = document.getElementById('tabella-commesse');
    if(!tbody) return;
    tbody.innerHTML = ''; 
    if (lista.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">Nessuna commessa trovata</td></tr>'; return; }

    lista.forEach(com => {
        const index = commesseCorrenti.findIndex(c => c.id === com.id);
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition-colors cursor-pointer';
        tr.addEventListener('click', () => apriSchedaCommessa(index)); 
        
        const nomeCliente = com.clienti ? com.clienti.nome_ragione_sociale : 'Sconosciuto';
        const cantiere = com.nome_cantiere || '--';
        const sedeTesto = com.sede_gestione ? '<div class="text-[9px] font-bold text-indigo-600 mt-1 uppercase">' + com.sede_gestione + '</div>' : '';

        let bgStato = 'bg-gray-100 text-gray-700';
        if (com.stato === 'Conclusa') bgStato = 'bg-emerald-100 text-emerald-800 font-bold';
        if (com.stato === 'In Assistenza / Ripristino') bgStato = 'bg-orange-100 text-orange-800 font-bold';
        if (com.stato === 'Contestazione') bgStato = 'bg-red-100 text-red-800 font-bold';
        
        tr.innerHTML = '<td class="px-6 py-4 font-semibold text-gray-900">' + com.numero + ' ' + sedeTesto + '</td>' +
                       '<td class="px-6 py-4 text-gray-600">' + nomeCliente + '</td>' +
                       '<td class="px-6 py-4 text-gray-600 font-medium">' + cantiere + '</td>' +
                       '<td class="px-6 py-4"><span class="px-3 py-1 ' + bgStato + ' rounded-full text-[10px] uppercase tracking-wider">' + (com.stato || 'Preventivi') + '</span></td>';
        tbody.appendChild(tr);
    });
}

function filtraCommesse() {
    const q = document.getElementById('input-ricerca-commesse').value.toLowerCase();
    const filtrate = commesseCorrenti.filter(c => 
        (c.numero && c.numero.toLowerCase().includes(q)) || 
        (c.clienti && c.clienti.nome_ragione_sociale && c.clienti.nome_ragione_sociale.toLowerCase().includes(q)) ||
        (c.nome_cantiere && c.nome_cantiere.toLowerCase().includes(q))
    );
    disegnaListaCommesse(filtrate);
}

// ================= SCHEDA COMMESSA =================
function apriSchedaCommessa(index) {
    commessaAttivaIndex = index;
    const com = commesseCorrenti[index];

    aggiornaDatiSchedaUI();
    disegnaToDo();
    caricaCronologia(com.id);

    document.getElementById('vista-elenco').classList.replace('flex', 'hidden');
    document.getElementById('vista-scheda').classList.replace('hidden', 'flex');
    window.history.replaceState({}, document.title, window.location.pathname);
}

function chiudiScheda() {
    commessaAttivaIndex = null;
    document.getElementById('vista-scheda').classList.replace('flex', 'hidden');
    document.getElementById('vista-elenco').classList.replace('hidden', 'flex');
    caricaCommesse(); 
}

function aggiornaDatiSchedaUI() {
    if(commessaAttivaIndex === null) return;
    const com = commesseCorrenti[commessaAttivaIndex];
    document.getElementById('scheda-titolo').innerText = com.numero;
    
    const bdgSede = document.getElementById('scheda-badge-sede');
    if (com.sede_gestione) { bdgSede.innerText = com.sede_gestione; bdgSede.classList.remove('hidden'); } 
    else { bdgSede.classList.add('hidden'); }

    const nomeCliente = com.clienti ? com.clienti.nome_ragione_sociale : 'Sconosciuto';
    document.getElementById('scheda-sottotitolo-cliente').innerText = nomeCliente;
    document.getElementById('scheda-sottotitolo-cantiere').innerText = com.nome_cantiere || 'Nessun cantiere spec.';
    
    const selStato = document.getElementById('scheda-select-stato');
    if(selStato) {
        selStato.value = com.stato || 'Preventivo';
    }

    document.getElementById('data-nota-libera').value = new Date().toISOString().split('T')[0];
}

async function cambiaStatoManuale() {
    const com = commesseCorrenti[commessaAttivaIndex];
    const nuovoStato = document.getElementById('scheda-select-stato').value;
    
    if(com.stato === nuovoStato) return;
    
    const { error } = await supabaseClient.from('commesse').update({ stato: nuovoStato }).eq('id', com.id);
    if(!error) {
        await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: '🔄 Stato commessa modificato in: ' + nuovoStato, autore: UTENTE_CORRENTE }]);
        com.stato = nuovoStato;
        caricaCronologia(com.id);
        caricaCommesse(); 
    } else {
        alert("Errore cambio stato: " + error.message);
        document.getElementById('scheda-select-stato').value = com.stato || 'Preventivo';
    }
}

// ================= TO-DO LIST =================
function disegnaToDo() {
    const container = document.getElementById('todo-container');
    if(!container) return;
    container.innerHTML = '';
    
    const com = commesseCorrenti[commessaAttivaIndex];
    let arr = [0,0,0,0,0,0,0,0,0,0];
    
    if (com.fasi_cantiere) {
        let parsed = com.fasi_cantiere.split(',').map(Number);
        for(let i=0; i<10; i++) {
            arr[i] = parsed[i] ? 1 : 0; // Protezione sicurezza contro vecchi dati
        }
    }
    
    strutturaToDo.forEach(sezione => {
        let htmlSec = '<div class="mb-5"><h4 class="font-bold text-[#2e2a5b] text-sm mb-2">' + sezione.label + '</h4><div class="space-y-2 pl-2 border-l-2 border-gray-100 ml-1 py-1">';
        sezione.sub.forEach(item => {
            const isChecked = arr[item.idx] > 0;
            const checkedAttr = isChecked ? 'checked' : '';
            const spanStyle = isChecked ? 'text-gray-400 line-through' : 'text-gray-700 font-medium';
            
            htmlSec += '<label class="flex items-center gap-3 cursor-pointer group">' +
                       '<input type="checkbox" ' + checkedAttr + ' onchange="toggleToDo(' + item.idx + ', \'' + (sezione.label + ' - ' + item.label).replace(/'/g, "\\'") + '\')" class="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer">' +
                       '<span class="text-sm ' + spanStyle + ' group-hover:text-[#2e2a5b] transition-colors select-none">' + item.label + '</span>' +
                       '</label>';
        });
        htmlSec += '</div></div>';
        container.innerHTML += htmlSec;
    });
}

async function toggleToDo(idx, labelTesto) {
    const com = commesseCorrenti[commessaAttivaIndex];
    let arr = [0,0,0,0,0,0,0,0,0,0];
    
    if (com.fasi_cantiere) {
        let parsed = com.fasi_cantiere.split(',').map(Number);
        for(let i=0; i<10; i++) arr[i] = parsed[i] ? 1 : 0;
    }
    
    const isNowChecked = arr[idx] === 0; 
    arr[idx] = isNowChecked ? 1 : 0;
    
    const nuovaStringa = arr.join(',');
    
    const { error } = await supabaseClient.from('commesse').update({ fasi_cantiere: nuovaStringa }).eq('id', com.id);
    
    if (!error) {
        const logMsg = isNowChecked ? '✅ Completato: ' + labelTesto : '🔙 Annullato: ' + labelTesto;
        await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: logMsg, autore: UTENTE_CORRENTE }]);
        
        com.fasi_cantiere = nuovaStringa;
        disegnaToDo();
        caricaCronologia(com.id);
    } else {
        alert("Errore aggiornamento To-Do: " + error.message);
        disegnaToDo(); 
    }
}

// ================= DIARIO / LOG =================
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
    if (!error) { 
        chiudiModaleModificaLog(); 
        caricaCronologia(commesseCorrenti[commessaAttivaIndex].id); 
    } else { alert("Errore modifica log: " + error.message); }
}

async function eliminaLog() {
    const id = document.getElementById('mod-log-id').value;
    if (!confirm("ATTENZIONE: Vuoi eliminare definitivamente questa registrazione dal diario?")) return;
    const { error } = await supabaseClient.from('commesse_log').delete().eq('id', id);
    if (!error) { 
        chiudiModaleModificaLog(); 
        caricaCronologia(commesseCorrenti[commessaAttivaIndex].id); 
    } else { alert("Impossibile eliminare: " + error.message); }
}

async function salvaNotaLibera() {
    const inputNota = document.getElementById('input-nota-libera'); 
    const dataNota = document.getElementById('data-nota-libera').value; 
    const testo = inputNota.value; 
    if (!testo || testo.trim() === '') return; 
    const comId = commesseCorrenti[commessaAttivaIndex].id;
    
    let timestamp = new Date().toISOString(); 
    if (dataNota && dataNota !== new Date().toISOString().split('T')[0]) { 
        timestamp = new Date(dataNota + 'T12:00:00Z').toISOString(); 
    }
    const { error } = await supabaseClient.from('commesse_log').insert([{ 
        commessa_id: comId, 
        azione: "Nota / Diario", 
        nota: testo, 
        autore: UTENTE_CORRENTE, 
        created_at: timestamp 
    }]);
    
    if (!error) { 
        inputNota.value = ''; 
        caricaCronologia(comId); 
    } else { alert("Errore salvataggio nota: " + error.message); }
}

async function caricaCronologia(commessaId) {
    const divLog = document.getElementById('lista-cronologia'); 
    divLog.innerHTML = '<p class="text-sm text-gray-500 italic">Caricamento registro...</p>';
    
    const { data: logs, error } = await supabaseClient.from('commesse_log').select('*').eq('commessa_id', commessaId).order('created_at', { ascending: false });
    
    if (error || !logs || logs.length === 0) { divLog.innerHTML = '<p class="text-sm text-gray-500">Nessuna attività registrata.</p>'; return; }
    
    logsCorrenti = logs; 
    let html = '';
    
    logs.forEach(log => {
        const dateObj = new Date(log.created_at); 
        const dataFormat = dateObj.toLocaleDateString('it-IT') + ' ore ' + dateObj.toLocaleTimeString('it-IT', { hour: '2-digit', minute:'2-digit' }); 
        const autoreText = log.autore ? '&bull; 👤 ' + log.autore : '';
        const notaHtml = log.nota ? '<p class="text-sm text-gray-700 mt-2 bg-gray-50 p-2 rounded-lg border border-gray-100 shadow-inner">"' + log.nota + '"</p>' : '';
        
        let icona = '<div class="w-2 h-2 rounded-full bg-[#2e2a5b] mt-1 ring-4 ring-indigo-50"></div>';
        if (log.azione.includes('✅')) icona = '<div class="w-4 h-4 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-600 text-[10px] ring-2 ring-emerald-50">✓</div>';
        if (log.azione.includes('🔙')) icona = '<div class="w-4 h-4 rounded-full flex items-center justify-center bg-orange-100 text-orange-600 text-[10px] ring-2 ring-orange-50">!</div>';
        if (log.azione.includes('🔄')) icona = '<div class="w-4 h-4 rounded-full flex items-center justify-center bg-blue-100 text-blue-600 text-[10px] ring-2 ring-blue-50">~</div>';
        
        let iconaContainer = '<div class="cursor-pointer hover:scale-125 transition-transform mt-0.5" ondblclick="apriModaleModificaLog(\'' + log.id + '\')" title="Doppio clic per modificare">' + icona + '</div>';
        let pData = '<p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-[#2e2a5b] transition-colors" ondblclick="apriModaleModificaLog(\'' + log.id + '\')" title="Doppio clic per modificare">' + dataFormat + ' ' + autoreText + '</p>';
        
        html += '<div class="flex gap-4 items-start pb-4 border-b border-gray-100 last:border-0 last:pb-0">' + iconaContainer + '<div class="flex-1"><div class="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-1"><p class="text-sm font-bold text-gray-900">' + log.azione + '</p>' + pData + '</div>' + notaHtml + '</div></div>';
    }); 
    divLog.innerHTML = html;
}

// ================= GESTIONE MODIFICA E NUOVA COMMESSA =================
function apriModaleModifica() {
    if (commessaAttivaIndex === null) return; 
    const com = commesseCorrenti[commessaAttivaIndex]; 
    document.getElementById('mod-com-id').value = com.id;
    document.getElementById('mod-com-sede').value = com.sede_gestione || ''; 
    document.getElementById('mod-com-nome-cantiere').value = com.nome_cantiere || ''; 
    document.getElementById('mod-com-indirizzo').value = com.indirizzo_cantiere || ''; 
    document.getElementById('mod-com-citta').value = com.citta_cantiere || ''; 
    document.getElementById('mod-com-referente').value = com.referente || ''; 
    document.getElementById('mod-com-tel-referente').value = com.telefono_referente || ''; 
    document.getElementById('mod-com-email-referente').value = com.email_referente || '';
    document.getElementById('modal-modifica-commessa').classList.remove('hidden');
}

function chiudiModaleModifica() { document.getElementById('modal-modifica-commessa').classList.add('hidden'); }

function apriModaleNuovaCommessa() { 
    document.getElementById('modal-nuova-commessa').classList.remove('hidden'); 
    const anno = new Date().getFullYear(); 
    document.getElementById('form-com-numero').value = 'COM-' + anno + '/' + (totaleCommesse + 1).toString().padStart(3, '0'); 
    document.getElementById('check-copia-dati').checked = false; 
}

function chiudiModaleNuovaCommessa() { 
    document.getElementById('modal-nuova-commessa').classList.add('hidden'); 
    document.getElementById('form-nuova-commessa').reset(); 
    window.history.replaceState({}, document.title, window.location.pathname); 
}

// ================= EVENT LISTENERS DEI FORM =================
function inizializzaListeners() {
    const legaSubmit = (idForm, funzioneHandler) => {
        const form = document.getElementById(idForm);
        if (form) form.addEventListener('submit', funzioneHandler);
    };

    const checkCopia = document.getElementById('check-copia-dati');
    if(checkCopia) {
        checkCopia.addEventListener('change', () => {
            const isChecked = document.getElementById('check-copia-dati').checked; const clienteId = document.getElementById('form-com-cliente').value;
            if (isChecked && clienteId) { 
                const cliente = listaClientiCache.find(c => String(c.id) === String(clienteId)); 
                if (cliente) { document.getElementById('form-com-indirizzo').value = cliente.indirizzo || ''; document.getElementById('form-com-citta').value = cliente.citta || ''; document.getElementById('form-com-referente').value = cliente.nome_ragione_sociale || ''; document.getElementById('form-com-tel-referente').value = cliente.telefono || ''; document.getElementById('form-com-email-referente').value = cliente.email || ''; } 
            } else { document.getElementById('form-com-indirizzo').value = ''; document.getElementById('form-com-citta').value = ''; document.getElementById('form-com-referente').value = ''; document.getElementById('form-com-tel-referente').value = ''; document.getElementById('form-com-email-referente').value = ''; }
        });
    }

    const formComCliente = document.getElementById('form-com-cliente');
    if(formComCliente) formComCliente.addEventListener('change', () => { if(document.getElementById('check-copia-dati').checked) { document.getElementById('check-copia-dati').dispatchEvent(new Event('change')); } });

    legaSubmit('form-nuova-commessa', async (e) => {
        e.preventDefault(); 
        const nuovaCommessa = { cliente_id: document.getElementById('form-com-cliente').value, sede_gestione: document.getElementById('form-com-sede').value || null, numero: document.getElementById('form-com-numero').value, nome_cantiere: document.getElementById('form-com-nome-cantiere').value, indirizzo_cantiere: document.getElementById('form-com-indirizzo').value, citta_cantiere: document.getElementById('form-com-citta').value, referente: document.getElementById('form-com-referente').value, telefono_referente: document.getElementById('form-com-tel-referente').value, email_referente: document.getElementById('form-com-email-referente').value, stato: 'Preventivo', valore: null, fasi_cantiere: '0,0,0,0,0,0,0,0,0,0' };
        const { data, error } = await supabaseClient.from('commesse').insert([nuovaCommessa]).select();
        if (!error && data) { await supabaseClient.from('commesse_log').insert([{ commessa_id: data[0].id, azione: 'Apertura nuovo cantiere', autore: UTENTE_CORRENTE }]); chiudiModaleNuovaCommessa(); caricaCommesse(); } else { alert("Errore salvataggio: " + error.message); }
    });

    legaSubmit('form-modifica-commessa', async (e) => {
        e.preventDefault(); 
        const id = document.getElementById('mod-com-id').value;
        const datiAggiornati = { sede_gestione: document.getElementById('mod-com-sede').value || null, nome_cantiere: document.getElementById('mod-com-nome-cantiere').value, indirizzo_cantiere: document.getElementById('mod-com-indirizzo').value, citta_cantiere: document.getElementById('mod-com-citta').value, referente: document.getElementById('mod-com-referente').value, telefono_referente: document.getElementById('mod-com-tel-referente').value, email_referente: document.getElementById('mod-com-email-referente').value };
        const { error } = await supabaseClient.from('commesse').update(datiAggiornati).eq('id', id);
        if (!error) { await supabaseClient.from('commesse_log').insert([{ commessa_id: id, azione: 'Dati anagrafici e operativi del cantiere aggiornati', autore: UTENTE_CORRENTE }]); chiudiModaleModifica(); Object.assign(commesseCorrenti[commessaAttivaIndex], datiAggiornati); aggiornaDatiSchedaUI(); caricaCronologia(id); caricaCommesse(); } else { alert("Errore modifica commessa: " + error.message); }
    });
}

async function confermaEliminazioneCommessa() {
    const com = commesseCorrenti[commessaAttivaIndex]; const conferma = prompt('ATTENZIONE: Stai per eliminare definitivamente la commessa ' + com.numero + '.\n\nPer confermare, digita la parola ELIMINA qui sotto:');
    if (conferma !== 'ELIMINA') return;
    await supabaseClient.from('commesse_log').delete().eq('commessa_id', com.id);
    const { error } = await supabaseClient.from('commesse').delete().eq('id', com.id);
    if (!error) { alert('Commessa eliminata con successo.'); chiudiModaleModifica(); chiudiScheda(); caricaCommesse(); } else { alert("Errore durante l'eliminazione: " + error.message); }
}
