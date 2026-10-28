// ==========================================
// 3 ESSE - MOTORE LOGICO COMMESSE IBRIDO
// ==========================================

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let UTENTE_CORRENTE = "Sistema";

let listaClientiCache = [];
let commesseCorrenti = []; 
let ordiniCommessaCache = [];
let ordiniGlobaliPerFiltro = [];
let sediGlobali = []; 
let totaleCommesse = 0; 
let logsCorrenti = []; 
let commessaAttivaIndex = null; 
let filtroAttivoUrl = 'tutte';

let todoPendente = { idx: null, label: '', nextState: 0, isTriState: false, isSiNo: false };

const strutturaToDo = [
    { id: 'prev', label: '1. Preventivo', sub: [
        { idx: 0, label: 'Calcolo', triState: false },
        { idx: 1, label: 'Verifica', triState: false },
        { idx: 2, label: 'Invio', triState: false }
    ]},
    { id: 'ril', label: '2. Rilievo misure', sub: [
        { idx: 3, label: 'Per Preventivo', triState: false },
        { idx: 4, label: 'Esecutive', triState: false }
    ]},
    { id: 'conf', label: '3. Esito Preventivo', sub: [
        { idx: 5, label: 'Preventivo Confermato [SI / NO]', isSiNo: true }
    ]},
    { id: 'contr', label: '4. Contratto', sub: [
        { idx: 6, label: 'Ricontrollo da C.O.', triState: false },
        { idx: 7, label: 'Verifica', triState: false },
        { idx: 8, label: 'Invio al cliente', triState: false },
        { idx: 9, label: 'Contratto Firmato', triState: false }
    ]},
    { id: 'pag', label: '5. Pagamenti', sub: [
        { idx: 10, label: 'Acconto', triState: true },
        { idx: 11, label: 'Saldo', triState: true }
    ]}
];

const sequenzaStatiOrdine = ['Ordine inviato', 'In Modifica', 'Conferma', 'Merce Arrivata'];
let statoPendenteOrdine = '';
let filtroOrdiniCommessa = 'Tutti';

document.addEventListener('DOMContentLoaded', async () => { 
    const nomeUtenteEl = document.getElementById('nome-utente-sidebar');
    if (nomeUtenteEl) UTENTE_CORRENTE = nomeUtenteEl.innerText;

    inizializzaListeners();

    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const clienteId = urlParams.get('cliente_id');
    const idToOpen = urlParams.get('id');
    const filtroUrl = urlParams.get('filtro');

    if (filtroUrl) {
        filtroAttivoUrl = filtroUrl;
    }

    if (action === 'new') {
        apriModaleNuovaCommessa();
    }

    try {
        await popolaTendinaClienti(); 
        await caricaSediTendina(); 
        await caricaOrdiniGlobaliPerFiltro();
        
        if (action === 'new' && clienteId) {
            const select = document.getElementById('form-com-cliente');
            if (select) {
                select.value = clienteId;
                const chk = document.getElementById('check-copia-dati');
                if (chk) chk.checked = true;
                setTimeout(() => select.dispatchEvent(new Event('change')), 150);
            }
        }
        
        await caricaCommesse(); 
    } catch(err) {
        console.error("Errore inizializzazione:", err);
        commesseCorrenti = [];
        disegnaListaCommesse([]);
        const lblCount = document.getElementById('conteggio-commesse');
        if(lblCount) lblCount.innerText = '0 commesse (Errore)';
    }

    if (idToOpen) {
        const index = commesseCorrenti.findIndex(c => String(c.id) === String(idToOpen));
        if (index !== -1) apriSchedaCommessa(index);
    }
});

function formattaEuro(numero) {
    if (!numero || isNaN(parseFloat(numero))) return '€ 0,00';
    const numFloat = parseFloat(numero);
    const parti = numFloat.toFixed(2).split('.');
    const interi = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'"); 
    const decimali = parti[1] || '00';
    return '€ ' + interi + ',' + decimali;
}

function renderMarkdown(testo) {
    if (!testo) return '<span class="text-gray-400 italic">Clicca qui per aggiungere materiali o promemoria...</span>';
    let html = testo.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    return html;
}

function attivaModificaRiepilogo() {
    document.getElementById('preview-riepilogo-commessa').classList.add('hidden');
    const ta = document.getElementById('testo-riepilogo-commessa');
    ta.classList.remove('hidden');
    document.getElementById('btn-salva-riepilogo').classList.remove('hidden');
    ta.focus();
}

async function salvaRiepilogoCommessa() {
    const btn = document.getElementById('btn-salva-riepilogo');
    btn.innerText = "Salvataggio...";
    const testo = document.getElementById('testo-riepilogo-commessa').value;
    const com = commesseCorrenti[commessaAttivaIndex];
    
    const { error } = await supabaseClient.from('commesse').update({ descrizione_materiali: testo || null }).eq('id', com.id);
    if (!error) {
        com.descrizione_materiali = testo;
        document.getElementById('preview-riepilogo-commessa').innerHTML = renderMarkdown(testo);
        document.getElementById('testo-riepilogo-commessa').classList.add('hidden');
        document.getElementById('preview-riepilogo-commessa').classList.remove('hidden');
        btn.classList.add('hidden');
        btn.innerText = "Salva note";
    } else {
        alert("Errore salvataggio note: " + error.message);
        btn.innerText = "Salva note";
    }
}

async function caricaOrdiniGlobaliPerFiltro() {
    try {
        const { data } = await supabaseClient.from('ordini_fornitori').select('commessa_id, contratto_id, stato');
        if (data) {
            ordiniGlobaliPerFiltro = data.map(o => ({
                commessa_id: o.commessa_id,
                stato: o.stato
            }));
        }
    } catch(e) {
        ordiniGlobaliPerFiltro = [];
    }
}

async function caricaFileSuStorage(file, prefisso) {
    if (!file) return null;
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '');
    const dataOggi = new Date().toISOString().split('T')[0];
    const randomHash = Math.random().toString(36).substring(2, 6);
    const fileName = prefisso + '_' + dataOggi + '_' + Date.now() + '_' + cleanFileName + '_' + randomHash;
    
    const { error } = await supabaseClient.storage.from('contratti_docs').upload(fileName, file, { cacheControl: '3600', upsert: false });
    if (error) { alert("Errore upload: " + error.message); return null; }
    const { data } = supabaseClient.storage.from('contratti_docs').getPublicUrl(fileName);
    return data.publicUrl;
}

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
    let commesse = [];
    try {
        let { data: rawCommesse, error: err2 } = await supabaseClient.from('commesse').select('*').order('id', { ascending: false });
        if (err2) throw err2;
        
        const { data: allClienti } = await supabaseClient.from('clienti').select('id, nome_ragione_sociale');
        commesse = (rawCommesse || []).map(com => {
            if (allClienti) {
                com.clienti = allClienti.find(c => String(c.id) === String(com.cliente_id));
            }
            return com;
        });
    } catch(e) {
        console.error("Errore query commesse:", e);
        commesse = [];
    }

    commesseCorrenti = commesse;
    const lblCount = document.getElementById('conteggio-commesse');
    if(lblCount) lblCount.innerText = commesseCorrenti.length + ' commesse in corso';
    
    filtraCommesse();
}

function applicaFiltroRapido(tipoFiltro) {
    filtroAttivoUrl = tipoFiltro;
    filtraCommesse();
}

function filtraCommesse() {
    const searchInput = document.getElementById('input-ricerca-commesse');
    const q = searchInput ? searchInput.value.toLowerCase() : '';
    
    const idsPillole = ['tutte', 'preventivi_aperti', 'preventivi_confermati', 'contratti_firmati', 'ordini_inattesa', 'materiale_inarrivo', 'fatture_inattesa'];
    idsPillole.forEach(id => {
        const b = document.getElementById('pill-' + id);
        if(b) {
            if (id === filtroAttivoUrl) {
                b.className = "px-4 py-2 text-xs font-bold text-white bg-[#2e2a5b] rounded-lg shadow-sm whitespace-nowrap transition-colors";
            } else {
                b.className = "px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg whitespace-nowrap transition-colors";
            }
        }
    });

    const filtrate = commesseCorrenti.filter(c => {
        try {
            const nomeCli = (c.clienti && c.clienti.nome_ragione_sociale) ? String(c.clienti.nome_ragione_sociale).toLowerCase() : '';
            const numCom = (c.numero) ? String(c.numero).toLowerCase() : '';
            const nomCant = (c.nome_cantiere) ? String(c.nome_cantiere).toLowerCase() : '';
            
            const matchTesto = numCom.includes(q) || nomeCli.includes(q) || nomCant.includes(q);
            if (!matchTesto) return false;

            if (filtroAttivoUrl === 'tutte') return true;

            let arr = [0,0,0,0,0,0,0,0,0,0,0,0];
            if (c.fasi_cantiere) {
                let parsed = c.fasi_cantiere.split(',').map(Number);
                for(let i=0; i<12; i++) arr[i] = parsed[i] || 0;
            }

            if (filtroAttivoUrl === 'preventivi_aperti') {
                return arr[5] === 0;
            } else if (filtroAttivoUrl === 'preventivi_confermati') {
                return arr[5] === 1;
            } else if (filtroAttivoUrl === 'contratti_firmati') {
                return arr[9] === 1;
            } else if (filtroAttivoUrl === 'fatture_inattesa') {
                return arr[10] === 1 || arr[11] === 1;
            } else if (filtroAttivoUrl === 'ordini_inattesa') {
                return ordiniGlobaliPerFiltro.some(o => String(o.commessa_id) === String(c.id) && 
                    (o.stato === 'Ordine inviato' || o.stato === 'Inviato' || o.stato === 'Richiesta Inviata' || o.stato === 'In Modifica'));
            } else if (filtroAttivoUrl === 'materiale_inarrivo') {
                return ordiniGlobaliPerFiltro.some(o => String(o.commessa_id) === String(c.id) && 
                    (o.stato === 'Conferma' || o.stato === 'Da controllare ed inviare' || o.stato === 'Approvato ed Inviato' || o.stato === 'Ordine confermato ed inviato al Fornitore'));
            }
        } catch (err) {
            console.error("Errore nel filtro:", err);
            return true;
        }

        return true;
    });

    disegnaListaCommesse(filtrate);
}

function disegnaListaCommesse(lista) {
    const tbody = document.getElementById('tabella-commesse');
    if(!tbody) return;
    tbody.innerHTML = ''; 
    
    if (!lista || lista.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-6 text-center text-gray-500">Nessuna commessa trovata con i filtri selezionati</td></tr>'; 
        return; 
    }

    lista.forEach(com => {
        const index = commesseCorrenti.findIndex(c => String(c.id) === String(com.id));
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
        
        let numCommessa = com.numero || '[Da Definire]';
        if (numCommessa === '[Pratica Rapida]') numCommessa = '<span class="text-orange-600">⚡ Rapida</span>';
        
        tr.innerHTML = '<td class="px-6 py-4 font-semibold text-gray-900">' + numCommessa + ' ' + sedeTesto + '</td>' +
                       '<td class="px-6 py-4 text-gray-600">' + nomeCliente + '</td>' +
                       '<td class="px-6 py-4 text-gray-600 font-medium">' + cantiere + '</td>' +
                       '<td class="px-6 py-4"><span class="px-3 py-1 ' + bgStato + ' rounded-full text-[10px] uppercase tracking-wider">' + (com.stato || 'Preventivo') + '</span></td>';
        tbody.appendChild(tr);
    });
}

function apriSchedaCommessa(index) {
    if (index === -1) return;
    commessaAttivaIndex = index;
    const com = commesseCorrenti[index];

    aggiornaDatiSchedaUI();
    disegnaToDo();
    caricaCronologia(com.id);
    cambiaTab('todo');

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

function cambiaTab(tabName) {
    const tabs = ['todo', 'ordini', 'posa'];
    tabs.forEach(t => {
        const btn = document.getElementById('tab-btn-' + t);
        const cnt = document.getElementById('tab-content-' + t);
        if(btn) btn.className = "px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent transition-colors";
        if(cnt) cnt.className = "hidden";
    });
    
    const activeBtn = document.getElementById('tab-btn-' + tabName);
    if(activeBtn) activeBtn.className = "px-4 py-2 text-sm font-semibold text-[#2e2a5b] border-b-2 border-[#2e2a5b] transition-colors";
    
    if (tabName === 'todo') { document.getElementById('tab-content-todo').className = "block"; } 
    else if (tabName === 'ordini') { document.getElementById('tab-content-ordini').className = "block space-y-4 flex flex-col h-full"; caricaOrdiniDiQuestaCommessa(); } 
    else if (tabName === 'posa') { document.getElementById('tab-content-posa').className = "block space-y-4"; caricaPosaInterventi(); } 
}

function aggiornaDatiSchedaUI() {
    if(commessaAttivaIndex === null) return;
    const com = commesseCorrenti[commessaAttivaIndex];
    
    document.getElementById('scheda-titolo').innerHTML = (com.numero === '[Pratica Rapida]') ? '<span class="text-orange-600">⚡ Pratica Rapida</span>' : (com.numero || '[Da Definire]');
    
    const bdgSede = document.getElementById('scheda-badge-sede');
    if (com.sede_gestione) { bdgSede.innerText = com.sede_gestione; bdgSede.classList.remove('hidden'); } 
    else { bdgSede.classList.add('hidden'); }

    const nomeCliente = com.clienti ? com.clienti.nome_ragione_sociale : 'Sconosciuto';
    document.getElementById('scheda-sottotitolo-cliente').innerText = nomeCliente;
    document.getElementById('scheda-sottotitolo-cantiere').innerText = com.nome_cantiere || 'Nessun cantiere spec.';
    
    const testoRiep = com.descrizione_materiali || '';
    document.getElementById('testo-riepilogo-commessa').value = testoRiep;
    document.getElementById('preview-riepilogo-commessa').innerHTML = renderMarkdown(testoRiep);
    document.getElementById('preview-riepilogo-commessa').classList.remove('hidden');
    document.getElementById('testo-riepilogo-commessa').classList.add('hidden');
    document.getElementById('btn-salva-riepilogo').classList.add('hidden');

    const selStato = document.getElementById('scheda-select-stato');
    if(selStato) selStato.value = com.stato || 'Preventivo';

    document.getElementById('data-nota-libera').value = new Date().toISOString().split('T')[0];
}

async function cambiaStatoManuale() {
    const com = commesseCorrenti[commessaAttivaIndex];
    const nuovoStato = document.getElementById('scheda-select-stato').value;
    if(com.stato === nuovoStato) return;
    
    const { error } = await supabaseClient.from('commesse').update({ stato: nuovoStato }).eq('id', com.id);
    if(!error) {
        await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: '🔄 Stato commessa modificato in: ' + nuovoStato, autore: UTENTE_CORRENTE }]);
        com.stato = nuovoStato; caricaCronologia(com.id); caricaCommesse(); 
    } else {
        alert("Errore cambio stato: " + error.message);
        document.getElementById('scheda-select-stato').value = com.stato || 'Preventivo';
    }
}

// ================= TO-DO E DIARIO =================
function disegnaToDo() {
    const container = document.getElementById('todo-container');
    if(!container) return;
    container.innerHTML = '';
    const com = commesseCorrenti[commessaAttivaIndex];
    let arr = [0,0,0,0,0,0,0,0,0,0,0,0];
    if (com.fasi_cantiere) {
        let parsed = com.fasi_cantiere.split(',').map(Number);
        for(let i=0; i<12; i++) arr[i] = parsed[i] || 0; 
    }
    
    strutturaToDo.forEach(sezione => {
        let htmlSec = '<div class="mb-5"><h4 class="font-bold text-[#2e2a5b] text-sm mb-2">' + sezione.label + '</h4><div class="space-y-2 pl-2 border-l-2 border-gray-100 ml-1 py-1">';
        sezione.sub.forEach(item => {
            const val = arr[item.idx] || 0;
            const isTri = item.triState ? 'true' : 'false';
            const isSiNo = item.isSiNo ? 'true' : 'false';
            
            let spanStyle = 'text-gray-700 font-medium';
            let boxHtml = '<div class="w-4 h-4 border-2 border-gray-300 rounded bg-white flex-shrink-0 mt-0.5 transition-colors"></div>';
            
            if (val === 1 && item.triState) {
                spanStyle = 'text-indigo-700 font-bold';
                boxHtml = '<div class="w-4 h-4 border-2 border-indigo-500 rounded bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors"><div class="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div></div>';
            } else if ((val === 1 && !item.triState && !item.isSiNo) || (val === 2 && item.triState) || (val === 1 && item.isSiNo)) {
                spanStyle = item.isSiNo ? 'text-emerald-700 font-bold' : 'text-gray-400 line-through';
                boxHtml = '<div class="w-4 h-4 border-2 border-emerald-500 rounded bg-emerald-500 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors"><span class="text-white text-[10px] font-bold leading-none">✓</span></div>';
            } else if (val === 2 && item.isSiNo) {
                spanStyle = 'text-red-600 font-bold line-through';
                boxHtml = '<div class="w-4 h-4 border-2 border-red-500 rounded bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors"><span class="text-white text-[10px] font-bold leading-none">✕</span></div>';
            }
            
            let disabledClass = '';
            if (item.idx > 5 && arr[5] !== 1) { 
                disabledClass = ' opacity-40 pointer-events-none grayscale';
            }
            
            const safeLabel = (sezione.label + ' - ' + item.label).replace(/'/g, "\\'");
            const callFunc = 'richiediConfermaToDo(' + item.idx + ', \'' + safeLabel + '\', ' + val + ', ' + isTri + ', ' + isSiNo + ')';
            
            htmlSec += '<div onclick="' + callFunc + '" class="flex items-start gap-3 cursor-pointer group' + disabledClass + '">' + boxHtml + '<span class="text-sm ' + spanStyle + ' group-hover:text-[#2e2a5b] transition-colors select-none">' + item.label + '</span></div>';
        });
        htmlSec += '</div></div>';
        container.innerHTML += htmlSec;
    });
}

function richiediConfermaToDo(idx, labelTesto, currentState, isTriState, isSiNo) {
    const com = commesseCorrenti[commessaAttivaIndex];
    
    if (idx === 0 && currentState === 0 && (!com.numero || com.numero === '[Da Definire]')) {
        let msg = 'Questa commessa non ha ancora un numero assegnato.\n\n';
        msg += 'Inserisci la numerazione ufficiale (es. COM-' + new Date().getFullYear() + '/001).\n';
        msg += 'Se è una lavorazione veloce, lascialo vuoto.';
        
        const nuovoNum = prompt(msg);
        
        if (nuovoNum !== null) { 
            let numFinale = nuovoNum.trim();
            if (numFinale === '') numFinale = '[Pratica Rapida]';
            
            const tempTitolo = document.getElementById('scheda-titolo').innerText;
            document.getElementById('scheda-titolo').innerText = 'Salvataggio in corso...';
            
            supabaseClient.from('commesse').update({ numero: numFinale }).eq('id', com.id).then(function(res) {
                if(!res.error) {
                    com.numero = numFinale;
                    aggiornaDatiSchedaUI();
                    supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: 'Assegnato numero commessa: ' + numFinale, autore: UTENTE_CORRENTE }]).then(function(){
                        caricaCronologia(com.id);
                        avviaLogicaModalToDo(idx, labelTesto, currentState, isTriState, isSiNo);
                    });
                } else {
                    alert('Errore DB: ' + res.error.message);
                    document.getElementById('scheda-titolo').innerText = tempTitolo;
                }
            });
        }
        return; 
    }
    
    avviaLogicaModalToDo(idx, labelTesto, currentState, isTriState, isSiNo);
}

function avviaLogicaModalToDo(idx, labelTesto, currentState, isTriState, isSiNo) {
    let nextState = 0;
    if (isTriState || isSiNo) { nextState = (currentState + 1) % 3; } 
    else { nextState = currentState === 0 ? 1 : 0; }
    
    todoPendente = { idx: idx, label: labelTesto, nextState: nextState, isTriState: isTriState, isSiNo: isSiNo };

    document.getElementById('todo-nota-testo').value = '';
    let modalTitolo = '';
    
    if (isTriState) {
        if (nextState === 1) modalTitolo = 'Fattura Inviata / Attesa Pagamento';
        else if (nextState === 2) modalTitolo = 'Conferma Incasso Ricevuto';
        else modalTitolo = 'Annulla Operazioni Pagamento';
    } else if (isSiNo) {
        if (nextState === 1) modalTitolo = 'Preventivo ACCETTATO (SI)';
        else if (nextState === 2) modalTitolo = 'Preventivo RIFIUTATO (NO)';
        else modalTitolo = 'Annulla Esito Preventivo';
    } else {
        modalTitolo = nextState === 1 ? 'Conferma Completamento' : 'Annulla Completamento';
    }
    
    document.getElementById('todo-nota-titolo').innerText = modalTitolo;
    document.getElementById('todo-nota-sub').innerText = labelTesto;
    document.getElementById('modal-todo-nota').classList.remove('hidden');
}

function annullaToDoNota() {
    document.getElementById('modal-todo-nota').classList.add('hidden');
    todoPendente = { idx: null, label: '', nextState: 0, isTriState: false, isSiNo: false };
}

async function confermaToDoNota() {
    const btn = document.getElementById('btn-conferma-todo');
    btn.innerText = "Salvataggio..."; btn.disabled = true;

    const com = commesseCorrenti[commessaAttivaIndex];
    let arr = [0,0,0,0,0,0,0,0,0,0,0,0];
    if (com.fasi_cantiere) {
        let parsed = com.fasi_cantiere.split(',').map(Number);
        for(let i=0; i<12; i++) arr[i] = parsed[i] || 0;
    }

    arr[todoPendente.idx] = todoPendente.nextState;
    const nuovaStringa = arr.join(',');
    const notaTesto = document.getElementById('todo-nota-testo').value.trim();

    const { error } = await supabaseClient.from('commesse').update({ fasi_cantiere: nuovaStringa }).eq('id', com.id);
    if (!error) {
        let logMsg = '';
        if (todoPendente.isTriState) {
            if (todoPendente.nextState === 1) logMsg = '📤 Inviata/In Attesa: ' + todoPendente.label;
            else if (todoPendente.nextState === 2) logMsg = '✅ Pagato/Incassato: ' + todoPendente.label;
            else logMsg = '🔙 Annullato: ' + todoPendente.label;
        } else if (todoPendente.isSiNo) {
            if (todoPendente.nextState === 1) logMsg = '✅ Cliente ha ACCETTATO: ' + todoPendente.label;
            else if (todoPendente.nextState === 2) logMsg = '❌ Cliente ha RIFIUTATO: ' + todoPendente.label;
            else logMsg = '🔙 Annullato esito: ' + todoPendente.label;
        } else {
            logMsg = todoPendente.nextState === 1 ? '✅ Completato: ' + todoPendente.label : '🔙 Annullato: ' + todoPendente.label;
        }
        
        await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: logMsg, nota: notaTesto || null, autore: UTENTE_CORRENTE }]);
        com.fasi_cantiere = nuovaStringa;
        disegnaToDo(); caricaCronologia(com.id);
    } else {
        alert("Errore aggiornamento To-Do: " + error.message);
        disegnaToDo();
    }

    document.getElementById('modal-todo-nota').classList.add('hidden');
    todoPendente = { idx: null, label: '', nextState: 0, isTriState: false, isSiNo: false };
    btn.innerText = "Conferma"; btn.disabled = false;
}

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
    let timestamp = new Date().toISOString(); if (nuovaData) timestamp = new Date(nuovaData).toISOString();
    const { error } = await supabaseClient.from('commesse_log').update({ azione: nuovaAzione, nota: nuovaNota || null, created_at: timestamp }).eq('id', id);
    if (!error) { chiudiModaleModificaLog(); caricaCronologia(commesseCorrenti[commessaAttivaIndex].id); } else { alert("Errore modifica log: " + error.message); }
}

async function eliminaLog() {
    const id = document.getElementById('mod-log-id').value;
    if (!confirm("ATTENZIONE: Vuoi eliminare definitivamente questa registrazione dal diario?")) return;
    const { error } = await supabaseClient.from('commesse_log').delete().eq('id', id);
    if (!error) { chiudiModaleModificaLog(); caricaCronologia(commesseCorrenti[commessaAttivaIndex].id); } else { alert("Impossibile eliminare: " + error.message); }
}

async function salvaNotaLibera() {
    const inputNota = document.getElementById('input-nota-libera'); 
    const dataNota = document.getElementById('data-nota-libera').value; 
    const testo = inputNota.value; 
    if (!testo || testo.trim() === '') return; 
    const comId = commesseCorrenti[commessaAttivaIndex].id;
    let timestamp = new Date().toISOString(); 
    if (dataNota && dataNota !== new Date().toISOString().split('T')[0]) { timestamp = new Date(dataNota + 'T12:00:00Z').toISOString(); }
    const { error } = await supabaseClient.from('commesse_log').insert([{ commessa_id: comId, azione: "Nota / Diario", nota: testo, autore: UTENTE_CORRENTE, created_at: timestamp }]);
    if (!error) { inputNota.value = ''; caricaCronologia(comId); } else { alert("Errore salvataggio nota: " + error.message); }
}

async function caricaCronologia(commessaId) {
    const divLog = document.getElementById('lista-cronologia'); 
    divLog.innerHTML = '<p class="text-sm text-gray-500 italic">Caricamento registro...</p>';
    const { data: logs, error } = await supabaseClient.from('commesse_log').select('*').eq('commessa_id', commessaId).order('created_at', { ascending: false });
    if (error || !logs || logs.length === 0) { divLog.innerHTML = '<p class="text-sm text-gray-500">Nessuna attività registrata.</p>'; return; }
    
    logsCorrenti = logs; let html = '';
    logs.forEach(log => {
        const dateObj = new Date(log.created_at); 
        const dataFormat = dateObj.toLocaleDateString('it-IT') + ' ore ' + dateObj.toLocaleTimeString('it-IT', { hour: '2-digit', minute:'2-digit' }); 
        const autoreText = log.autore ? '&bull; 👤 ' + log.autore : '';
        const notaHtml = log.nota ? '<p class="text-sm text-gray-700 mt-2 bg-gray-50 p-2 rounded-lg border border-gray-100 shadow-inner">"' + log.nota + '"</p>' : '';
        const fileHtml = log.file_url ? '<a href="' + log.file_url + '" target="_blank" class="mt-2 inline-block px-3 py-1.5 bg-blue-50 text-blue-700 rounded text-xs font-bold border border-blue-100">📎 Apri Documento</a>' : '';
        
        let icona = '<div class="w-2 h-2 rounded-full bg-[#2e2a5b] mt-1 ring-4 ring-indigo-50 shrink-0"></div>';
        if (log.azione.includes('✅')) icona = '<div class="w-4 h-4 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-600 text-[10px] ring-2 ring-emerald-50 shrink-0">✓</div>';
        if (log.azione.includes('❌') || log.azione.includes('🔙')) icona = '<div class="w-4 h-4 rounded-full flex items-center justify-center bg-red-100 text-red-600 text-[10px] ring-2 ring-red-50 shrink-0">✕</div>';
        if (log.azione.includes('🔄')) icona = '<div class="w-4 h-4 rounded-full flex items-center justify-center bg-blue-100 text-blue-600 text-[10px] ring-2 ring-blue-50 shrink-0">~</div>';
        if (log.azione.includes('📤')) icona = '<div class="w-4 h-4 rounded-full flex items-center justify-center bg-indigo-100 text-indigo-600 text-[10px] ring-2 ring-indigo-50 shrink-0">~</div>';
        if (log.azione.includes('Rilievo') || log.azione.includes('📐')) icona = '<div class="w-4 h-4 rounded-full flex items-center justify-center bg-blue-100 text-blue-700 text-[10px] ring-2 ring-blue-50 shrink-0">📐</div>';
        if (log.azione.includes('Ordine') || log.azione.includes('📦')) icona = '<div class="w-4 h-4 rounded-full flex items-center justify-center bg-teal-100 text-teal-700 text-[10px] ring-2 ring-teal-50 shrink-0">📦</div>';
        if (log.azione.includes('💶')) icona = '<div class="w-4 h-4 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-600 text-[10px] ring-2 ring-emerald-50 shrink-0">€</div>';

        let iconaContainer = '<div class="cursor-pointer hover:scale-125 transition-transform mt-0.5" ondblclick="apriModaleModificaLog(\'' + log.id + '\')" title="Doppio clic per modificare">' + icona + '</div>';
        let pData = '<p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-[#2e2a5b] transition-colors" ondblclick="apriModaleModificaLog(\'' + log.id + '\')" title="Doppio clic per modificare">' + dataFormat + ' ' + autoreText + '</p>';
        
        html += '<div class="flex gap-4 items-start pb-4 border-b border-gray-100 last:border-0 last:pb-0">' + iconaContainer + '<div class="flex-1"><div class="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-1"><p class="text-sm font-bold text-gray-900 leading-tight">' + log.azione + '</p>' + pData + '</div>' + notaHtml + fileHtml + '</div></div>';
    }); 
    divLog.innerHTML = html;
}

// ================= GESTIONE ORDINI FORNITORI =================
function cambiaSubTabOrdini(tab) { filtroOrdiniCommessa = tab; aggiornaStileTabsOrdini(); disegnaOrdiniCommessa(); }

function aggiornaStileTabsOrdini() {
    const tabs = [ { id: 'Tutti', label: 'Registro Ordini' }, { id: 'Ordine inviato', label: 'Inviati' }, { id: 'In Modifica', label: 'In Modifica' }, { id: 'Conferma', label: 'Confermati / In Arrivo' }, { id: 'Merce Arrivata', label: 'Merce Arrivata' } ];
    let counts = { 'Tutti': ordiniCommessaCache.length, 'Ordine inviato': 0, 'In Modifica': 0, 'Conferma': 0, 'Merce Arrivata': 0 };
    ordiniCommessaCache.forEach(o => {
        let s = o.stato || 'Ordine inviato';
        if(s === 'Inviato' || s === 'Richiesta Inviata') s = 'Ordine inviato';
        if(s === 'Da controllare ed inviare' || s === 'Approvato ed Inviato' || s === 'Ordine confermato ed inviato al Fornitore') s = 'Conferma';
        if(s === 'Merce Arrivata in Magazzino') s = 'Merce Arrivata';
        if(counts[s] !== undefined) counts[s]++;
    });
    tabs.forEach(t => {
        const btn = document.getElementById('subtab-ord-' + t.id.replace(/ /g, ''));
        if (btn) {
            btn.innerHTML = t.label + ' <span class="ml-1 opacity-80">(' + counts[t.id] + ')</span>';
            if (t.id === filtroOrdiniCommessa) { btn.className = "px-4 py-2 text-sm font-bold text-white bg-[#2e2a5b] rounded-lg shadow-sm transition-colors whitespace-nowrap flex items-center"; } 
            else { btn.className = "px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg transition-colors whitespace-nowrap flex items-center"; }
        }
    });
}

async function caricaFornitoriTendina() {
    const { data: fornitori } = await supabaseClient.from('fornitori').select('id, nome_azienda').order('nome_azienda');
    if (fornitori) { const select = document.getElementById('form-ord-new-fornitore'); select.innerHTML = '<option value="">-- Seleziona --</option>'; fornitori.forEach(f => select.innerHTML += '<option value="' + f.id + '">' + f.nome_azienda + '</option>'); }
}

async function apriModaleNuovoOrdineDaCommessa() {
    const com = commesseCorrenti[commessaAttivaIndex];
    if(document.getElementById('form-ord-new-fornitore').options.length <= 1) await caricaFornitoriTendina();
    document.getElementById('form-nuovo-ordine-commessa').reset();
    document.getElementById('form-ord-new-data').value = new Date().toISOString().split('T')[0];
    document.getElementById('modal-nuovo-ordine-commessa').classList.remove('hidden');
}
function chiudiModaleNuovoOrdineDaCommessa() { document.getElementById('modal-nuovo-ordine-commessa').classList.add('hidden'); }

async function caricaOrdiniDiQuestaCommessa() {
    const com = commesseCorrenti[commessaAttivaIndex];
    const tbody = document.getElementById('lista-ordini-commessa'); 
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-4 text-center text-gray-500">Caricamento ordini in corso...</td></tr>';
    const { data: ordini, error } = await supabaseClient.from('ordini_fornitori').select('*, fornitori(nome_azienda)').eq('commessa_id', com.id).order('created_at', { ascending: false });
    if (error) { tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-4 text-center text-red-500">Errore di rete.</td></tr>'; return; }
    ordiniCommessaCache = ordini || []; 
    aggiornaStileTabsOrdini(); disegnaOrdiniCommessa();
}

function disegnaOrdiniCommessa() {
    const tbody = document.getElementById('lista-ordini-commessa');
    tbody.innerHTML = '';
    const filtrati = ordiniCommessaCache.filter(ord => {
        let statoPulito = ord.stato || 'Ordine inviato';
        if(statoPulito === 'Inviato' || statoPulito === 'Richiesta Inviata') statoPulito = 'Ordine inviato';
        if(statoPulito === 'Da controllare ed inviare' || statoPulito === 'Approvato ed Inviato' || statoPulito === 'Ordine confermato ed inviato al Fornitore') statoPulito = 'Conferma';
        if(statoPulito === 'Merce Arrivata in Magazzino') statoPulito = 'Merce Arrivata';
        ord.statoPulito = statoPulito;
        if (filtroOrdiniCommessa === 'Tutti') return true;
        return statoPulito === filtroOrdiniCommessa;
    });

    if (filtrati.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-4 text-center text-gray-500">Nessun ordine.</td></tr>'; return; }

    let html = '';
    filtrati.forEach(ord => {
        const originalIndex = ordiniCommessaCache.indexOf(ord);
        const statoPulito = ord.statoPulito;
        const fornitoreNome = ord.fornitori ? ord.fornitori.nome_azienda : 'Fornitore Extra'; 
        
        let descVisuale = ord.descrizione || '';
        if (descVisuale && descVisuale.includes('[SOSTITUZIONE/ASSISTENZA]')) { descVisuale = descVisuale.replace('[SOSTITUZIONE/ASSISTENZA]', '<span class="bg-orange-100 text-orange-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-orange-300 mr-1">⚠️ Sostituzione</span>'); }
        
        let dataStatoStr = '--'; let labelData = 'Inserito';
        if (statoPulito === 'Ordine inviato' && ord.data_ordine) { dataStatoStr = new Date(ord.data_ordine).toLocaleDateString('it-IT'); labelData = 'Inviato'; } 
        else if (statoPulito === 'In Modifica' && ord.data_ordine) { dataStatoStr = new Date(ord.data_ordine).toLocaleDateString('it-IT'); labelData = 'Da Modificare'; } 
        else if (statoPulito === 'Conferma' && ord.data_conferma) { dataStatoStr = new Date(ord.data_conferma).toLocaleDateString('it-IT'); labelData = 'Confermato'; } 
        else if (statoPulito === 'Merce Arrivata' && ord.data_arrivo_merce) { dataStatoStr = new Date(ord.data_arrivo_merce).toLocaleDateString('it-IT'); labelData = 'Arrivato'; } 
        else if (ord.created_at) { dataStatoStr = new Date(ord.created_at).toLocaleDateString('it-IT'); labelData = 'Creato'; }
        const htmlDataCella = '<div class="font-bold text-gray-900">' + dataStatoStr + '</div><div class="text-[10px] text-gray-400 uppercase tracking-wider">' + labelData + '</div>';

        let stringaConsegna = '<span class="text-gray-400 text-xs">Consegna non definita</span>';
        if (ord.data_presunta_consegna) { const d = ord.data_presunta_consegna.split('-'); stringaConsegna = '<span class="text-gray-600 text-xs">Consegna: <strong>' + d[2] + '/' + d[1] + '/' + d[0] + '</strong></span>'; }

        let badgeClass = 'bg-gray-100 text-gray-600';
        if(statoPulito === 'Ordine inviato') badgeClass = 'bg-blue-100 text-blue-700';
        if(statoPulito === 'In Modifica') badgeClass = 'bg-red-100 text-red-800 border border-red-200';
        if(statoPulito === 'Conferma') badgeClass = 'bg-yellow-100 text-yellow-800';
        if(statoPulito === 'Merce Arrivata') badgeClass = 'bg-teal-100 text-teal-800';
        
        html += '<tr class="hover:bg-gray-50"><td class="px-4 py-3 font-bold text-gray-900">' + fornitoreNome + '</td><td class="px-4 py-3 text-gray-700 text-xs">' + descVisuale + '</td><td class="px-4 py-3">' + htmlDataCella + '</td><td class="px-4 py-3 w-40"><span class="px-2 py-1 ' + badgeClass + ' rounded text-[10px] font-bold uppercase leading-tight inline-block text-center w-full">' + statoPulito + '</span><div class="mt-1">' + stringaConsegna + '</div></td><td class="px-4 py-3 text-center"><button onclick="apriModaleGestioneOrdine(' + originalIndex + ')" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-[#2e2a5b] rounded text-xs font-bold transition-colors border border-gray-200 shadow-sm">✏️</button></td></tr>';
    });
    tbody.innerHTML = html;
}

function apriModaleGestioneOrdine(indexMemoria) {
    const ord = ordiniCommessaCache[indexMemoria]; const nomeFornitore = ord.fornitori ? ord.fornitori.nome_azienda : 'Fornitore';
    document.getElementById('gest-ord-id').value = ord.id; 
    
    const subTitolo = document.getElementById('sottotitolo-gestione-ordine');
    if(subTitolo) subTitolo.innerText = 'Gestione per: ' + nomeFornitore;
    
    let statoPartenza = ord.stato || 'Ordine inviato';
    if(statoPartenza === 'Inviato' || statoPartenza === 'Richiesta Inviata') statoPartenza = 'Ordine inviato';
    if(statoPartenza === 'Da controllare ed inviare' || statoPartenza === 'Approvato ed Inviato' || statoPartenza === 'Ordine confermato ed inviato al Fornitore') statoPartenza = 'Conferma';
    if(statoPartenza === 'Merce Arrivata in Magazzino') statoPartenza = 'Merce Arrivata';
    
    document.getElementById('gest-ord-costo-conf').value = ord.costo_confermato || ''; 
    document.getElementById('gest-ord-data-ordine').value = ord.data_ordine || (ord.created_at ? ord.created_at.split('T')[0] : '');
    document.getElementById('gest-ord-data-conferma').value = ord.data_conferma || '';
    document.getElementById('gest-ord-revisione').value = ord.revisione || 0; 
    document.getElementById('gest-ord-data-presunta').value = ord.data_presunta_consegna || ''; 
    document.getElementById('gest-ord-data-arrivo').value = ord.data_arrivo_merce || ''; 
    document.getElementById('gest-ord-annotazioni').value = ord.descrizione || ord.annotazioni || ''; 
    document.getElementById('gest-ord-file').value = ''; 
    
    impostaStatoPendenteOrdine(statoPartenza); 
    document.getElementById('modal-gestisci-ordine').classList.remove('hidden');
}

function chiudiModaleGestioneOrdine() { document.getElementById('modal-gestisci-ordine').classList.add('hidden'); }

function impostaStatoPendenteOrdine(nuovoStato) {
    statoPendenteOrdine = nuovoStato; 
    const container = document.getElementById('stepper-container-ordine'); const azioniBox = document.getElementById('stepper-azioni-ordine'); container.innerHTML = ''; azioniBox.innerHTML = '';
    const currentIdx = sequenzaStatiOrdine.indexOf(statoPendenteOrdine); const bgLine = document.createElement('div'); bgLine.className = 'absolute top-1/2 left-0 w-full h-1 bg-gray-200 -z-10 -translate-y-1/2 rounded-full mx-4'; container.appendChild(bgLine);
    
    sequenzaStatiOrdine.forEach((stato, index) => {
        const punto = document.createElement('div'); punto.className = 'flex flex-col items-center gap-1 bg-gray-50 px-2 z-10 cursor-pointer';
        punto.onclick = () => impostaStatoPendenteOrdine(stato);

        let iconaHTML = '<div class="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] bg-gray-200 text-gray-500 border-2 border-white">' + (index + 1) + '</div>';
        if (index < currentIdx || (currentIdx === sequenzaStatiOrdine.length -1 && index === currentIdx)) { iconaHTML = '<div class="w-6 h-6 rounded-full flex items-center justify-center bg-emerald-500 text-white shadow-sm font-bold text-[10px]">✓</div>'; } 
        else if (index === currentIdx) { let col = stato === 'In Modifica' ? 'bg-red-500 ring-red-100' : 'bg-blue-500 ring-blue-100'; iconaHTML = '<div class="w-6 h-6 rounded-full flex items-center justify-center ' + col + ' text-white font-bold text-[10px] shadow-md ring-2">' + (index + 1) + '</div>'; }
        let textColor = (index <= currentIdx) ? 'text-gray-900 font-bold' : 'text-gray-400'; if(index === currentIdx && stato === 'In Modifica') textColor = 'text-red-600 font-bold';
        punto.innerHTML = iconaHTML + '<span class="text-[9px] mt-1 uppercase tracking-wider text-center w-16 leading-tight ' + textColor + '">' + stato + '</span>'; 
        container.appendChild(punto);
    });
    
    document.getElementById('box-ord-data-conferma').classList.add('hidden'); document.getElementById('box-ord-costo').classList.add('hidden'); document.getElementById('box-ord-presunta').classList.add('hidden'); document.getElementById('box-ord-arrivo').classList.add('hidden');
    
    const oggi = new Date().toISOString().split('T')[0];

    if (statoPendenteOrdine === 'In Modifica') {
        document.getElementById('gest-ord-data-ordine').value = oggi;
        azioniBox.innerHTML = '<button type="button" onclick="impostaStatoPendenteOrdine(\'Ordine inviato\')" class="text-xs font-medium text-gray-600 bg-white border border-gray-300 px-3 py-2 rounded-lg">&larr; Indietro</button><div class="flex-1"></div><button type="button" onclick="impostaStatoPendenteOrdine(\'Conferma\')" class="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg shadow-sm">Passa a Conferma &rarr;</button>';
    } else if (statoPendenteOrdine === 'Ordine inviato') {
        azioniBox.innerHTML = '<div class="flex-1"></div><button type="button" onclick="impostaStatoPendenteOrdine(\'In Modifica\')" class="text-xs font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 px-4 py-2 rounded-lg shadow-sm mr-2 flex items-center gap-1">⚠️ Da Modificare</button><button type="button" onclick="impostaStatoPendenteOrdine(\'Conferma\')" class="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg shadow-sm">Passa a Conferma &rarr;</button>';
    } else if (statoPendenteOrdine === 'Conferma') {
        const lConferma = document.getElementById('box-ord-data-conferma'); lConferma.classList.remove('hidden'); lConferma.querySelector('label').innerText = "Data Invio Conferma";
        document.getElementById('box-ord-costo').classList.remove('hidden'); document.getElementById('box-ord-presunta').classList.remove('hidden');
        document.getElementById('gest-ord-data-conferma').value = oggi;
        azioniBox.innerHTML = '<button type="button" onclick="impostaStatoPendenteOrdine(\'In Modifica\')" class="text-xs font-medium text-gray-600 bg-white border border-gray-300 px-3 py-2 rounded-lg">&larr; Indietro</button><div class="flex-1"></div><button type="button" onclick="impostaStatoPendenteOrdine(\'Merce Arrivata\')" class="text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg shadow-sm">Passa a Merce Arrivata &rarr;</button>';
    } else if (statoPendenteOrdine === 'Merce Arrivata') {
        const lConferma = document.getElementById('box-ord-data-conferma'); lConferma.classList.remove('hidden'); lConferma.querySelector('label').innerText = "Data Invio Conferma";
        document.getElementById('box-ord-costo').classList.remove('hidden'); document.getElementById('box-ord-arrivo').classList.remove('hidden');
        if(!document.getElementById('gest-ord-data-arrivo').value) document.getElementById('gest-ord-data-arrivo').value = oggi;
        azioniBox.innerHTML = '<button type="button" onclick="impostaStatoPendenteOrdine(\'Conferma\')" class="text-xs font-medium text-gray-600 bg-white border border-gray-300 px-3 py-2 rounded-lg">&larr; Indietro</button>';
    }
}

async function eliminaOrdineDaCommessa() {
    const idOrdine = document.getElementById('gest-ord-id').value;
    if(!confirm("Sei sicuro di voler eliminare definitivamente questo ordine?")) return;
    const { error } = await supabaseClient.from('ordini_fornitori').delete().eq('id', idOrdine);
    if(!error){ chiudiModaleGestioneOrdine(); caricaOrdiniDiQuestaCommessa(); await supabaseClient.from('commesse_log').insert([{ commessa_id: commesseCorrenti[commessaAttivaIndex].id, azione: `Eliminato Ordine dal sistema`, autore: UTENTE_CORRENTE }]); caricaCronologia(commesseCorrenti[commessaAttivaIndex].id); } else { alert("Errore durante l'eliminazione: " + error.message); }
}

async function caricaPosaInterventi() {
    const com = commesseCorrenti[commessaAttivaIndex]; const divLista = document.getElementById('lista-interventi-posa'); divLista.innerHTML = '<p class="text-sm text-gray-500">Caricamento in corso...</p>';
    const { data: interventi, error } = await supabaseClient.from('interventi_posa').select('*').eq('commessa_id', com.id).order('data_intervento', { ascending: false });
    if (error) { divLista.innerHTML = '<p class="text-sm text-red-500">Errore DB posa.</p>'; return; }
    if (!interventi || interventi.length === 0) { divLista.innerHTML = '<div class="p-6 bg-gray-50 border border-dashed border-gray-300 rounded-xl text-center"><p class="text-sm text-gray-500">Nessun intervento registrato. Aggiungilo quando vai in cantiere!</p></div>'; return; }
    let html = '';
    interventi.forEach(int => {
        const dataSplit = int.data_intervento ? int.data_intervento.split('-') : ['','','']; const dataIta = int.data_intervento ? (dataSplit[2] + '/' + dataSplit[1] + '/' + dataSplit[0]) : '--';
        const note = int.note ? '<p class="text-sm text-gray-700 mt-2 bg-gray-50 p-2 rounded">' + int.note + '</p>' : ''; const btnFile = int.file_url ? '<a href="' + int.file_url + '" target="_blank" class="mt-2 inline-block px-3 py-1 bg-emerald-50 text-emerald-700 rounded text-xs font-bold border border-emerald-100">📷 Apri Foto / PDF</a>' : '';
        html += '<div class="p-4 bg-white border border-gray-200 rounded-xl shadow-sm mb-3"><div class="flex justify-between items-start"><div><span class="font-bold text-gray-900 text-lg">📅 ' + dataIta + '</span><span class="ml-2 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">' + int.posatore + '</span></div><button onclick="eliminaPosa(' + int.id + ')" class="text-red-400 hover:text-red-600 font-bold">&times;</button></div>' + note + ' ' + btnFile + '</div>';
    }); 
    divLista.innerHTML = html;
}
function apriModalePosa() { document.getElementById('form-intervento-posa').reset(); document.getElementById('posa-data').value = new Date().toISOString().split('T')[0]; document.getElementById('modal-intervento-posa').classList.remove('hidden'); }
function chiudiModalePosa() { document.getElementById('modal-intervento-posa').classList.add('hidden'); }
async function eliminaPosa(id) { if(!confirm("Vuoi eliminare questa registrazione di posa?")) return; await supabaseClient.from('interventi_posa').delete().eq('id', id); caricaPosaInterventi(); }

function apriModaleModifica() {
    if (commessaAttivaIndex === null) return; 
    const com = commesseCorrenti[commessaAttivaIndex]; 
    document.getElementById('mod-com-id').value = com.id;
    
    let numCorrente = com.numero || '';
    if (numCorrente === '[Da Definire]' || numCorrente === '[Pratica Rapida]') numCorrente = '';
    document.getElementById('mod-com-numero').value = numCorrente;

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
    document.getElementById('form-com-numero').value = ''; 
    document.getElementById('check-copia-dati').checked = false; 
}

function chiudiModaleNuovaCommessa() { 
    document.getElementById('modal-nuova-commessa').classList.add('hidden'); 
    document.getElementById('form-nuova-commessa').reset(); 
    window.history.replaceState({}, document.title, window.location.pathname); 
}

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
        
        let valNumero = document.getElementById('form-com-numero').value.trim();
        if (valNumero === '') valNumero = '[Da Definire]';
        
        const nuovaCommessa = { cliente_id: document.getElementById('form-com-cliente').value, sede_gestione: document.getElementById('form-com-sede').value || null, numero: valNumero, nome_cantiere: document.getElementById('form-com-nome-cantiere').value, indirizzo_cantiere: document.getElementById('form-com-indirizzo').value, citta_cantiere: document.getElementById('form-com-citta').value, referente: document.getElementById('form-com-referente').value, telefono_referente: document.getElementById('form-com-tel-referente').value, email_referente: document.getElementById('form-com-email-referente').value, stato: 'Preventivo', valore: null, fasi_cantiere: '0,0,0,0,0,0,0,0,0,0,0,0', descrizione_materiali: null };
        const { data, error } = await supabaseClient.from('commesse').insert([nuovaCommessa]).select();
        if (!error && data) { await supabaseClient.from('commesse_log').insert([{ commessa_id: data[0].id, azione: 'Apertura nuovo cantiere', autore: UTENTE_CORRENTE }]); chiudiModaleNuovaCommessa(); caricaCommesse(); } else { alert("Errore salvataggio: " + error.message); }
    });

    legaSubmit('form-modifica-commessa', async (e) => {
        e.preventDefault(); 
        const id = document.getElementById('mod-com-id').value;
        
        let valNumero = document.getElementById('mod-com-numero').value.trim();
        if (valNumero === '') valNumero = '[Da Definire]';

        const datiAggiornati = { numero: valNumero, sede_gestione: document.getElementById('mod-com-sede').value || null, nome_cantiere: document.getElementById('mod-com-nome-cantiere').value, indirizzo_cantiere: document.getElementById('mod-com-indirizzo').value, citta_cantiere: document.getElementById('mod-com-citta').value, referente: document.getElementById('mod-com-referente').value, telefono_referente: document.getElementById('mod-com-tel-referente').value, email_referente: document.getElementById('mod-com-email-referente').value };
        const { error } = await supabaseClient.from('commesse').update(datiAggiornati).eq('id', id);
        if (!error) { await supabaseClient.from('commesse_log').insert([{ commessa_id: id, azione: 'Dati anagrafici e operativi del cantiere aggiornati', autore: UTENTE_CORRENTE }]); chiudiModaleModifica(); Object.assign(commesseCorrenti[commessaAttivaIndex], datiAggiornati); aggiornaDatiSchedaUI(); caricaCronologia(id); caricaCommesse(); } else { alert("Errore modifica commessa: " + error.message); }
    });

    legaSubmit('form-intervento-posa', async (e) => {
        e.preventDefault(); const btn = document.getElementById('btn-salva-posa'); const com = commesseCorrenti[commessaAttivaIndex]; btn.innerText = "Salvataggio..."; btn.disabled = true;
        let fileUrl = null; const fileInput = document.getElementById('posa-file');
        if (fileInput.files.length > 0) { btn.innerText = "Caricamento foto..."; fileUrl = await caricaFileSuStorage(fileInput.files[0], 'POSA'); }
        const nuovoInt = { commessa_id: com.id, data_intervento: document.getElementById('posa-data').value, posatore: document.getElementById('posa-squadra').value, note: document.getElementById('posa-note').value || null, file_url: fileUrl };
        const { error } = await supabaseClient.from('interventi_posa').insert([nuovoInt]);
        if (!error) { 
            await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: 'Registrato intervento di posa in cantiere da: ' + nuovoInt.posatore, file_url: fileUrl, autore: UTENTE_CORRENTE }]); 
            chiudiModalePosa(); caricaPosaInterventi(); caricaCronologia(com.id); 
        } else { alert("Errore posa: " + error.message); }
        btn.innerText = "Salva Intervento"; btn.disabled = false;
    });

    legaSubmit('form-gestisci-ordine', async (e) => {
        e.preventDefault(); 
        const btnSubmit = document.getElementById('btn-salva-gest-ordine'); const idOrdine = document.getElementById('gest-ord-id').value; const com = commesseCorrenti[commessaAttivaIndex]; const ordOriginale = ordiniCommessaCache.find(o => o.id == idOrdine); const nomeFornitore = ordOriginale.fornitori ? ordOriginale.fornitori.nome_azienda : 'Fornitore';
        btnSubmit.innerText = "Salvataggio..."; btnSubmit.disabled = true;
        let fileUrl = null; const fileInputUpdate = document.getElementById('gest-ord-file'); if (fileInputUpdate.files.length > 0) fileUrl = await caricaFileSuStorage(fileInputUpdate.files[0], 'ORD_CONF');
        let datiUpdate = { stato: statoPendenteOrdine, costo_confermato: document.getElementById('gest-ord-costo-conf').value || null, data_ordine: document.getElementById('gest-ord-data-ordine').value || null, data_conferma: document.getElementById('gest-ord-data-conferma').value || null, data_presunta_consegna: document.getElementById('gest-ord-data-presunta').value || null, revisione: document.getElementById('gest-ord-revisione').value, data_arrivo_merce: document.getElementById('gest-ord-data-arrivo').value || null, descrizione: document.getElementById('gest-ord-annotazioni').value || null };
        if(fileUrl) datiUpdate.file_url = (ordOriginale.file_url && ordOriginale.file_url.trim() !== '') ? ordOriginale.file_url + ',' + fileUrl : fileUrl;
        const { error } = await supabaseClient.from('ordini_fornitori').update(datiUpdate).eq('id', idOrdine);
        if (!error) {
            await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: 'Ordine a ' + nomeFornitore + ' aggiornato in: ' + statoPendenteOrdine.toUpperCase(), nota: datiUpdate.descrizione, file_url: fileUrl, autore: UTENTE_CORRENTE }]);
            if (statoPendenteOrdine === 'Merce Arrivata') {
                const { data: tuttiOrdini } = await supabaseClient.from('ordini_fornitori').select('stato, commessa_id').eq('commessa_id', com.id);
                if (tuttiOrdini && tuttiOrdini.length > 0) {
                    const tuttiArrivati = tuttiOrdini.every(o => o.stato === 'Merce Arrivata');
                    if (tuttiArrivati) {
                        await supabaseClient.from('commesse').update({ stato: 'Posa' }).eq('id', com.id);
                        await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: '⚡ Tutta la merce del cantiere è arrivata! Il cantiere avanza a: POSA', autore: 'Sistema Auto' }]);
                    }
                }
            }
            chiudiModaleGestioneOrdine(); caricaOrdiniDiQuestaCommessa(); caricaCronologia(com.id);
        } else { alert("Errore ordine: " + error.message); }
        btnSubmit.innerText = "Salva Ordine"; btnSubmit.disabled = false;
    });

    legaSubmit('form-nuovo-ordine-commessa', async (e) => {
        e.preventDefault(); const btnSubmit = document.getElementById('btn-salva-nuovo-ordine-commessa'); const dataOrdine = document.getElementById('form-ord-new-data').value; const com = commesseCorrenti[commessaAttivaIndex];
        btnSubmit.innerText = "Salvataggio..."; btnSubmit.disabled = true;
        const isSostituzione = document.getElementById('form-ord-sostituzione').checked; let testoDescrizione = document.getElementById('form-ord-new-descrizione').value;
        if (isSostituzione) testoDescrizione = '[SOSTITUZIONE/ASSISTENZA] ' + testoDescrizione;
        const nuovoOrdine = { commessa_id: com.id, fornitore_id: document.getElementById('form-ord-new-fornitore').value, data_ordine: dataOrdine, descrizione: testoDescrizione, stato: 'Ordine inviato', revisione: 0 };
        const { data, error } = await supabaseClient.from('ordini_fornitori').insert([nuovoOrdine]).select('*, fornitori(nome_azienda)');
        if (!error) {
            const nomeFornitore = data[0].fornitori ? data[0].fornitori.nome_azienda : 'Fornitore'; const labelAssistenza = isSostituzione ? ' ⚠️ (In Sostituzione / Post-Posa)' : '';
            await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: 'Creato Ordine Inviato a: ' + nomeFornitore + labelAssistenza, autore: UTENTE_CORRENTE }]);
            chiudiModaleNuovoOrdineDaCommessa(); caricaOrdiniDiQuestaCommessa(); caricaCronologia(com.id);
        } else { alert("Errore ordine: " + error.message); }
        btnSubmit.innerText = "Crea Ordine"; btnSubmit.disabled = false;
    });
}

async function confermaEliminazioneCommessa() {
    const com = commesseCorrenti[commessaAttivaIndex]; const conferma = prompt('ATTENZIONE: Stai per eliminare definitivamente la commessa ' + com.numero + ' e TUTTI i dati ad essa collegati.\n\nPer confermare, digita la parola ELIMINA qui sotto:');
    if (conferma !== 'ELIMINA') return;
    await supabaseClient.from('ordini_fornitori').delete().eq('commessa_id', com.id);
    await supabaseClient.from('interventi_posa').delete().eq('commessa_id', com.id); 
    await supabaseClient.from('commesse_log').delete().eq('commessa_id', com.id);
    const { error } = await supabaseClient.from('commesse').delete().eq('id', com.id);
    if (!error) { alert('Commessa eliminata con successo.'); chiudiModaleModifica(); chiudiScheda(); caricaCommesse(); } else { alert("Errore durante l'eliminazione: " + error.message); }
}
