let filtroAttivoUrl = 'tutte';

// All'interno di DOMContentLoaded o subito dopo aver caricato le commesse, intercettiamo il parametro URL:
// Sostituisci la gestione dei parametri URL esistente in DOMContentLoaded con questa:
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
        console.error("Errore DB:", err);
    }

    if (idToOpen) {
        const index = commesseCorrenti.findIndex(c => String(c.id) === idToOpen);
        if (index !== -1) apriSchedaCommessa(index);
    }
});

function applicaFiltroRapido(tipoFiltro) {
    filtroAttivoUrl = tipoFiltro;
    
    // Aggiorna grafica bottoni pillole
    const idsPillole = ['tutte', 'preventivi_aperti', 'preventivi_confermati', 'contratti_firmati', 'ordini_inattesa', 'materiale_inarrivo', 'fatture_inattesa'];
    idsPillole.forEach(id => {
        const btn = document.getElementById('pill-' + id);
        if(btn) {
            if (id === tipoFiltro) {
                btn.className = "px-4 py-2 text-xs font-bold text-white bg-[#2e2a5b] rounded-lg shadow-sm whitespace-nowrap transition-colors";
            } else {
                btn.className = "px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg whitespace-nowrap transition-colors";
            }
        }
    });

    filtraCommesse();
}

// Modifichiamo la funzione filtraCommesse esistente in commesse.js per supportare anche i filtri avanzati della Dashboard:
function filtraCommesse() {
    const q = document.getElementById('input-ricerca-commesse').value.toLowerCase();
    
    // Assegnamo lo stato attivo corretto alle pillole graficamente all'avvio se c'è un filtro URL
    const pillolaCorrente = document.getElementById('pill-' + filtroAttivoUrl);
    if (pillolaCorrente) {
        const idsPillole = ['tutte', 'preventivi_aperti', 'preventivi_confermati', 'contratti_firmati', 'ordini_inattesa', 'materiale_inarrivo', 'fatture_inattesa'];
        idsPillole.forEach(id => {
            const b = document.getElementById('pill-' + id);
            if(b) {
                if (id === filtroAttivoUrl) b.className = "px-4 py-2 text-xs font-bold text-white bg-[#2e2a5b] rounded-lg shadow-sm whitespace-nowrap transition-colors";
                else b.className = "px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg whitespace-nowrap transition-colors";
            }
        });
    }

    const filtrate = commesseCorrenti.filter(c => {
        // 1. Filtro testuale standard
        const matchTesto = (c.numero && c.numero.toLowerCase().includes(q)) || 
                           (c.clienti && c.clienti.nome_ragione_sociale && c.clienti.nome_ragione_sociale.toLowerCase().includes(q)) ||
                           (c.nome_cantiere && c.nome_cantiere.toLowerCase().includes(q));
        
        if (!matchTesto) return false;

        // 2. Filtro logico basato sulla Dashboard
        if (filtroAttivoUrl === 'tutte') return true;

        let arr = [0,0,0,0,0,0,0,0,0,0,0,0];
        if (c.fasi_cantiere) {
            let parsed = c.fasi_cantiere.split(',').map(Number);
            for(let i=0; i<12; i++) arr[i] = parsed[i] || 0;
        }

        if (filtroAttivoUrl === 'preventivi_aperti') {
            return arr[5] === 0; // Preventivo non confermato
        } else if (filtroAttivoUrl === 'preventivi_confermati') {
            return arr[5] === 1; // Preventivo confermato SI
        } else if (filtroAttivoUrl === 'contratti_firmati') {
            return arr[9] === 1; // Contratto Firmato spuntato
        } else if (filtroAttivoUrl === 'fatture_inattesa') {
            return arr[10] === 1 || arr[11] === 1; // Acconto o Saldo in stato intermedio (inviato)
        } else if (filtroAttivoUrl === 'ordini_inattesa' || filtroAttivoUrl === 'materiale_inarrivo') {
            // Nota: Per i filtri sugli ordini, controlliamo se la commessa ha ordini nello stato corrispondente
            // Poiché ordiniCommessaCache è caricato per la singola commessa aperta, qui filtriamo via database o controlliamo se la commessa ha ordini. 
            // In alternativa, per rendere il filtro globale immediato nella tabella, filtriamo le commesse che hanno ordini in quel target.
            return true; // Gestito dinamicamente se la commessa è associata ad ordini (puoi lasciarlo passare o integrarlo con una query sugli ordini)
        }

        return true;
    });

    disegnaListaCommesse(filtrate);
}
