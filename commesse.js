// ==========================================
// 3 ESSE - MOTORE LOGICO COMMESSE IBRIDO
// ==========================================

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let UTENTE_CORRENTE = "Sistema";

let listaClientiCache = [];
let commesseCorrenti = []; 
let ordiniCommessaCache = [];
let ordiniGlobaliPerFiltro = [];
let posaGlobaliPerFiltro = [];
let rilieviCommessaCache = [];
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
    ]},
    { id: 'chiusura', label: '6. Chiusura & Consegna', sub: [
        { idx: 12, label: 'Commessa Conclusa / Chiusa', triState: false }
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
        await caricaPosaGlobaliPerFiltro();
        
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
    let html = testo.replace(/\*\*(.*?)\*\*/g, '
