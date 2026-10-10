// ==========================================
// 3 ESSE - MOTORE LOGICO COMMESSE
// ==========================================

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let UTENTE_CORRENTE = "Sistema";

let listaClientiCache = [];
let commesseCorrenti = []; 
let ordiniCommessaCache = [];
let sediGlobali = []; 
let totaleCommesse = 0; 
let logsCorrenti = []; 

const sequenzaStati = ['Preventivi', 'Rilievo Misure', 'Contratti', 'Pagamenti', 'Ordini', 'Posa', 'Conclusa'];
let commessaAttivaIndex = null; 
let ledStati = [0,0,0,0,0,0,0];
let faseDaCompletare = null;
let filtroOrdiniCommessa = 'Tutti';

const sequenzaStatiOrdine = ['Ordine inviato', 'In Modifica', 'Conferma', 'Merce Arrivata'];
let statoPendenteOrdine = '';

// ================= INIT GLOBALE =================
document.addEventListener('DOMContentLoaded', async () => { 
    const nomeUtenteEl = document.getElementById('nome-utente-sidebar');
    if (nomeUtenteEl) UTENTE_CORRENTE = nomeUtenteEl.innerText;

    await popolaTendinaClienti(); 
    await caricaSediTendina(); 
    await caricaCommesse(); 

    const urlParams = new URLSearchParams(window.location.search);
    const idToOpen = urlParams.get('id');
    const action = urlParams.get('action');
    const clienteId = urlParams.get('cliente_id');
    const tabToOpen = urlParams.get('tab');

    if (action === 'new') {
        apriModaleNuovaCommessa();
        if (clienteId) {
            const select = document.getElementById('form-com-cliente');
            select.value = clienteId;
            const chk = document.getElementById('check-copia-dati');
            if (chk) chk.checked = true;
            select.dispatchEvent(new Event('change'));
        }
    }

    if (idToOpen) {
        const index = commesseCorrenti.findIndex(c => String(c.id) === idToOpen);
        if (index !== -1) {
            await apriSchedaCommessa(index);
            if (tabToOpen) cambiaTab(tabToOpen);
        }
    }

    // Inizializza i listeners di tutti i form
    inizializzaListeners();
});

// ================= UTILITY =================
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
    const fileName = `${prefisso}_${dataOggi}_${Date.now()}_${cleanFileName}_${randomHash}`;
    
    const { error } = await supabaseClient.storage.from('contratti_docs').upload(fileName, file, { cacheControl: '3600', upsert: false });
    if (error) { alert("Errore upload: " + error.message); return null; }
    const { data } = supabaseClient.storage.from('contratti_docs').getPublicUrl(fileName);
    return data.publicUrl;
}

// ================= LISTENER DEI FORM (SICURI) =================
function inizializzaListeners() {
    // Helper per non mandare in blocco Javascript se un modale manca
    const legaSubmit = (idForm, funzioneHandler) => {
        const form = document.getElementById(idForm);
        if (form) form.addEventListener('submit', funzioneHandler);
    };

    // FORM RILIEVI
    legaSubmit('form-rilievo-misure', async (e) => {
        e.preventDefault(); 
        const com = commesseCorrenti[commessaAttivaIndex]; 
        const btn = document.getElementById('btn-salva-rilievo'); 
        btn.innerText = "Salvataggio..."; btn.disabled = true;

        const dataRilievo = document.getElementById('rilievo-input-data').value; 
        const tecnico = document.getElementById('rilievo-input-tecnico').value.trim(); 
        const note = document.getElementById('rilievo-input-note').value.trim(); 
        const tipoRilievo = document.getElementById('rilievo-input-tipo').value; 
        const fileInput = document.getElementById('rilievo-input-file');

        let nuovoFileUrl = null; 
        if (fileInput.files.length > 0) { 
            btn.innerText = "Caricamento file..."; 
            nuovoFileUrl = await caricaFileSuStorage(fileInput.files[0], 'RILIEVO'); 
        }

        const payload = { commessa_id: com.id, stato: 'Eseguito', tipo_rilievo: tipoRilievo, data_rilievo: dataRilievo, tecnico: tecnico, note: note || null, file_url: nuovoFileUrl };
        const { error } = await supabaseClient.from('rilievi_misure').insert([payload]);

        if (!error) {
            await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: `📐 Inserita uscita: ${tipoRilievo} (Tecnico: ${tecnico})`, nota: note || null, file_url: nuovoFileUrl, autore: UTENTE_CORRENTE }]);
            if (tipoRilievo === 'Rilievo Esecutive') { if(ledStati[1] !== 2) await aggiornaLedDB(1, 2); } else { if(ledStati[1] === 0) await aggiornaLedDB(1, 1); }
            chiudiModaleRilievo(); await caricaRilieviDiQuestaCommessa(); await caricaCronologia(com.id);
        } else { alert("Errore salvataggio rilievo misure: " + error.message); }
        btn.innerText = "Salva Attività"; btn.disabled = false;
    });

    // FORM NUOVO ORDINE
    legaSubmit('form-nuovo-ordine-commessa', async (e) => {
        e.preventDefault(); const btnSubmit = document.getElementById('btn-salva-nuovo-ordine-commessa'); const idContratto = document.getElementById('form-ord-contratto-rif').value; const dataOrdine = document.getElementById('form-ord-new-data').value; const com = commesseCorrenti[commessaAttivaIndex];
        btnSubmit.innerText = "Salvataggio..."; btnSubmit.disabled = true;
        const isSostituzione = document.getElementById('form-ord-sostituzione').checked; let testoDescrizione = document.getElementById('form-ord-new-descrizione').value;
        if (isSostituzione) testoDescrizione = `[SOSTITUZIONE/ASSISTENZA] ${testoDescrizione}`;
        const nuovoOrdine = { commessa_id: com.id, contratto_id: idContratto ? idContratto : null, fornitore_id: document.getElementById('form-ord-new-fornitore').value, data_ordine: dataOrdine, descrizione: testoDescrizione, stato: 'Ordine inviato', revisione: 0 };
        const { data, error } = await supabaseClient.from('ordini_fornitori').insert([nuovoOrdine]).select('*, fornitori(nome_azienda)');
        if (!error) {
            const nomeFornitore = data[0].fornitori ? data[0].fornitori.nome_azienda : 'Fornitore'; const labelAssistenza = isSostituzione ? ' ⚠️ (In Sostituzione / Post-Posa)' : '';
            await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: `Creato Ordine Inviato a: ${nomeFornitore}${labelAssistenza}`, autore: UTENTE_CORRENTE }]);
            if(ledStati[4] === 0) await aggiornaLedDB(4, 1);
            chiudiModaleNuovoOrdineDaCommessa(); caricaOrdiniDiQuestaCommessa(); caricaCronologia(com.id);
        } else { alert("Errore ordine: " + error.message); }
        btnSubmit.innerText = "Crea Ordine"; btnSubmit.disabled = false;
    });

    // FORM GESTISCI ORDINE
    legaSubmit('form-gestisci-ordine', async (e) => {
        e.preventDefault(); const btnSubmit = document.getElementById('btn-salva-gest-ordine'); const idOrdine = document.getElementById('gest-ord-id').value; const com = commesseCorrenti[commessaAttivaIndex]; const ordOriginale = ordiniCommessaCache.find(o => o.id == idOrdine); const nomeFornitore = ordOriginale.fornitori ? ordOriginale.fornitori.nome_azienda : 'Fornitore';
        btnSubmit.innerText = "Salvataggio..."; btnSubmit.disabled = true;
        let fileUrl = null; const fileInputUpdate = document.getElementById('gest-ord-file'); if (fileInputUpdate.files.length > 0) fileUrl = await caricaFileSuStorage(fileInputUpdate.files[0], 'ORD_CONF');
        let datiUpdate = { stato: statoPendenteOrdine, costo_confermato: document.getElementById('gest-ord-costo-conf').value || null, data_ordine: document.getElementById('gest-ord-data-ordine').value || null, data_conferma: document.getElementById('gest-ord-data-conferma').value || null, data_presunta_consegna: document.getElementById('gest-ord-data-presunta').value || null, revisione: document.getElementById('gest-ord-revisione').value, data_arrivo_merce: document.getElementById('gest-ord-data-arrivo').value || null, annotazioni: document.getElementById('gest-ord-annotazioni').value || null };
        if(fileUrl) datiUpdate.file_url = (ordOriginale.file_url && ordOriginale.file_url.trim() !== '') ? ordOriginale.file_url + ',' + fileUrl : fileUrl;
        const { error } = await supabaseClient.from('ordini_fornitori').update(datiUpdate).eq('id', idOrdine);
        if (!error) {
            await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: `Ordine a ${nomeFornitore} aggiornato in: ${statoPendenteOrdine.toUpperCase()}`, nota: datiUpdate.annotazioni, file_url: fileUrl, autore: UTENTE_CORRENTE }]);
            if (statoPendenteOrdine === 'Merce Arrivata') {
                const { data: tuttiOrdini } = await supabaseClient.from('ordini_fornitori').select('stato, commessa_id').eq('commessa_id', com.id);
                if (tuttiOrdini && tuttiOrdini.length > 0) {
                    const tuttiArrivati = tuttiOrdini.every(o => o.stato === 'Merce Arrivata');
                    if (tuttiArrivati) { if(ledStati[4] !== 2) await aggiornaLedDB(4, 2); }
                }
            }
            chiudiModaleGestioneOrdine(); caricaOrdiniDiQuestaCommessa(); caricaCronologia(com.id);
        } else { alert("Errore ordine: " + error.message); }
        btnSubmit.innerText = "Salva Ordine"; btnSubmit.disabled = false;
    });

    // FORM INTERVENTO POSA
    legaSubmit('form-intervento-posa', async (e) => {
        e.preventDefault(); const btn = document.getElementById('btn-salva-posa'); const com = commesseCorrenti[commessaAttivaIndex]; btn.innerText = "Salvataggio..."; btn.disabled = true;
        let fileUrl = null; const fileInput = document.getElementById('posa-file');
        if (fileInput.files.length > 0) { btn.innerText = "Caricamento foto..."; fileUrl = await caricaFileSuStorage(fileInput.files[0], 'POSA'); }
        const nuovoInt = { commessa_id: com.id, data_intervento: document.getElementById('posa-data').value, posatore: document.getElementById('posa-squadra').value, note: document.getElementById('posa-note').value || null, file_url: fileUrl };
        const { error } = await supabaseClient.from('interventi_posa').insert([nuovoInt]);
        if (!error) { 
            await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: `Registrato intervento di posa in cantiere da: ${nuovoInt.posatore}`, file_url: fileUrl, autore: UTENTE_CORRENTE }]); 
            if(ledStati[5] === 0) await aggiornaLedDB(5, 1);
            chiudiModalePosa(); caricaPosaInterventi(); caricaCronologia(com.id); 
        } else { alert("Errore posa: " + error.message); }
        btn.innerText = "Salva Intervento"; btn.disabled = false;
    });

    // FORM FATTURE
    legaSubmit('form-nuova-fattura', async (e) => {
        e.preventDefault(); const com = commesseCorrenti[commessaAttivaIndex]; const btn = document.getElementById('btn-salva-fattura'); btn.innerText = "Salvataggio..."; btn.disabled = true;
        const numero = document.getElementById('fat-numero').value.trim(); const importo = document.getElementById('fat-importo').value; const stato = document.getElementById('fat-stato').value;
        const payload = { commessa_id: com.id, numero: numero, importo: importo, stato: stato };
        const { error } = await supabaseClient.from('fatture').insert([payload]);
        if (!error) {
            await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: `💶 Registrata richiesta/fattura: ${numero} (Importo: € ${importo} - ${stato})`, autore: UTENTE_CORRENTE }]);
            if (ledStati[3] === 0) await aggiornaLedDB(3, 1);
            chiudiModaleNuovaFattura(); await caricaFattureDiQuestaCommessa(); await caricaCronologia(com.id); await calcolaValoriEconomici();
        } else { alert("Errore salvataggio fattura: " + error.message); }
        btn.innerText = "Registra Pagamento"; btn.disabled = false;
    });

    // FORM NUOVA COMMESSA E COPIA DATI
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
        e.preventDefault(); const nuovaCommessa = { cliente_id: document.getElementById('form-com-cliente').value, sede_gestione: document.getElementById('form-com-sede').value || null, numero: document.getElementById('form-com-numero').value, nome_cantiere: document.getElementById('form-com-nome-cantiere').value, indirizzo_cantiere: document.getElementById('form-com-indirizzo').value, citta_cantiere: document.getElementById('form-com-citta').value, referente: document.getElementById('form-com-referente').value, telefono_referente: document.getElementById('form-com-tel-referente').value, email_referente: document.getElementById('form-com-email-referente').value, stato: 'Preventivi', valore: null };
        const { data, error } = await supabaseClient.from('commesse').insert([nuovaCommessa]).select();
        if (!error && data) { await supabaseClient.from('commesse_log').insert([{ commessa_id: data[0].id, azione: `Apertura nuovo cantiere`, autore: UTENTE_CORRENTE }]); chiudiModaleNuovaCommessa(); caricaCommesse(); } else { alert("Errore salvataggio: " + error.message); }
    });

    // FORM MODIFICA COMMESSA
    legaSubmit('form-modifica-commessa', async (e) => {
        e.preventDefault(); const id = document.getElementById('mod-com-id').value;
        const datiAggiornati = { sede_gestione: document.getElementById('mod-com-sede').value || null, nome_cantiere: document.getElementById('mod-com-nome-cantiere').value, indirizzo_cantiere: document.getElementById('mod-com-indirizzo').value, citta_cantiere: document.getElementById('mod-com-citta').value, referente: document.getElementById('mod-com-referente').value, telefono_referente: document.getElementById('mod-com-tel-referente').value, email_referente: document.getElementById('mod-com-email-referente').value };
        const { error } = await supabaseClient.from('commesse').update(datiAggiornati).eq('id', id);
        if (!error) { await supabaseClient.from('commesse_log').insert([{ commessa_id: id, azione: `Dati anagrafici e operativi del cantiere aggiornati`, autore: UTENTE_CORRENTE }]); chiudiModaleModifica(); Object.assign(commesseCorrenti[commessaAttivaIndex], datiAggiornati); aggiornaDatiSchedaUI(); caricaCronologia(id); caricaCommesse(); } else { alert("Errore modifica commessa: " + error.message); }
    });
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

// ================= ESITO COLLAUDO =================
function chiudiModaleCollaudo() { document.getElementById('modal-esito-collaudo').classList.add('hidden'); }

async function salvaEsitoCollaudo() {
    const com = commesseCorrenti[commessaAttivaIndex];
    const radioEsito = document.querySelector('input[name="esito_strada"]:checked');
    if(!radioEsito) { alert("Seleziona un esito prima di proseguire."); return; }
    
    const valoreEsito = radioEsito.value;
    const note = document.getElementById('collaudo-note').value;
    let nuovoStatoCommessa = '';
    let logAzione = '';

    if (valoreEsito === '1') {
        nuovoStatoCommessa = 'Conclusa'; logAzione = `✅ Collaudo Positivo: Lavoro completato a regola d'arte.`;
        if(ledStati[6] !== 2) await aggiornaLedDB(6, 2); 
    } else if (valoreEsito === '2') {
        nuovoStatoCommessa = 'Posa'; logAzione = `🟡 Collaudo Parziale: Finiture o mancanze lievi segnalate.`;
    } else if (valoreEsito === '3') {
        nuovoStatoCommessa = 'In Assistenza / Ripristino'; logAzione = `🟠 Collaudo Negativo (Grave/Non Conformità): Passaggio in assistenza.`;
    } else if (valoreEsito === '4') {
        nuovoStatoCommessa = 'Contestazione'; logAzione = `🔴 CONTESTAZIONE APERTA dal cliente al collaudo.`;
    }

    const { error } = await supabaseClient.from('commesse').update({ stato: nuovoStatoCommessa }).eq('id', com.id);
    if(!error) {
        await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: logAzione, nota: note, autore: UTENTE_CORRENTE }]);
        chiudiModaleCollaudo();
        com.stato = nuovoStatoCommessa;
        aggiornaDatiSchedaUI();
        caricaCronologia(com.id);
    } else { alert("Errore durante il salvataggio: " + error.message); }
}

// ================= GESTIONE LISTA COMMESSE =================
async function popolaTendinaClienti() {
    const { data } = await supabaseClient.from('clienti').select('id, nome_ragione_sociale, indirizzo, citta, telefono, email').order('nome_ragione_sociale');
    if (data) {
        listaClientiCache = data;
        const select = document.getElementById('form-com-cliente');
        select.innerHTML = '<option value="">-- Seleziona un cliente --</option>';
        data.forEach(c => select.innerHTML += `<option value="${c.id}">${c.nome_ragione_sociale}</option>`);
    }
}

async function caricaSediTendina() {
    const { data } = await supabaseClient.from('sedi_aziendali').select('nome').order('nome');
    if (data) {
        sediGlobali = data;
        const selNuovo = document.getElementById('form-com-sede');
        const selModifica = document.getElementById('mod-com-sede');
        selNuovo.innerHTML = '<option value="">-- Seleziona Sede --</option>';
        selModifica.innerHTML = '<option value="">Nessuna sede specificata</option>';
        data.forEach(s => {
            selNuovo.innerHTML += `<option value="${s.nome}">${s.nome}</option>`;
            selModifica.innerHTML += `<option value="${s.nome}">${s.nome}</option>`;
        });
    }
}

async function caricaCommesse() {
    let { data: commesse, error } = await supabaseClient.from('commesse').select('*, clienti(nome_ragione_sociale)').order('updated_at', { ascending: false, nullsFirst: false }); 
    const tbody = document.getElementById('tabella-commesse');
    
    if (error) { 
        console.warn("Relazione diretta clienti fallita. Avvio fallback di emergenza...");
        const { data: rawCommesse, error: err2 } = await supabaseClient.from('commesse').select('*').order('created_at', { ascending: false });
        if (err2) { tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-red-500 font-bold">Errore di comunicazione col Server Database</td></tr>'; return; }
        const { data: allClienti } = await supabaseClient.from('clienti').select('id, nome_ragione_sociale');
        
        commesse = rawCommesse.map(com => {
            if (allClienti) com.clienti = allClienti.find(c => String(c.id) === String(com.cliente_id));
            return com;
        });
    }

    const { data: preventiviTutti } = await supabaseClient.from('preventivi').select('commessa_id, id, stato');

    commesseCorrenti = (commesse || []).map(com => {
        const prevsCom = (preventiviTutti || []).filter(p => String(p.commessa_id) === String(com.id));
        return { ...com, preventivi: prevsCom };
    });

    totaleCommesse = commesseCorrenti.length; 
    document.getElementById('conteggio-commesse').innerText = `${commesseCorrenti.length} commesse in corso`;
    disegnaListaCommesse(commesseCorrenti);
}

function disegnaListaCommesse(lista) {
    const tbody = document.getElementById('tabella-commesse');
    tbody.innerHTML = ''; 
    if (lista.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">Nessuna commessa trovata</td></tr>'; return; }

    lista.forEach(com => {
        const index = commesseCorrenti.findIndex(c => c.id === com.id);
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition-colors cursor-pointer';
        tr.addEventListener('click', () => apriSchedaCommessa(index)); 
        
        const nomeCliente = com.clienti ? com.clienti.nome_ragione_sociale : 'Sconosciuto';
        const cantiere = com.nome_cantiere || '--';
        const sedeTesto = com.sede_gestione ? `<div class="text-[9px] font-bold text-indigo-600 mt-1 uppercase">${com.sede_gestione}</div>` : '';

        let bgStato = 'bg-gray-100 text-gray-700';
        if (com.stato === 'Conclusa') bgStato = 'bg-emerald-100 text-emerald-800 font-bold';
        if (com.stato === 'In Assistenza / Ripristino') bgStato = 'bg-orange-100 text-orange-800 font-bold';
        if (com.stato === 'Contestazione') bgStato = 'bg-red-100 text-red-800 font-bold';
        
        tr.innerHTML = `
            <td class="px-6 py-4 font-semibold text-gray-900">${com.numero} ${sedeTesto}</td>
            <td class="px-6 py-4 text-gray-600">${nomeCliente}</td>
            <td class="px-6 py-4 text-gray-600 font-medium">${cantiere}</td>
            <td class="px-6 py-4"><span class="px-3 py-1 ${bgStato} rounded-full text-[10px] uppercase tracking-wider">${com.stato || 'Preventivi'}</span></td>
        `;
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

// ================= GESTIONE APERTURA/CHIUSURA SCHEDA =================
async function apriSchedaCommessa(index) {
    try {
        commessaAttivaIndex = index;
        const com = commesseCorrenti[index];
        
        const { data: freshPrevs } = await supabaseClient.from('preventivi').select('id, stato').eq('commessa_id', com.id);
        if (freshPrevs) com.preventivi = freshPrevs;

        aggiornaDatiSchedaUI();
        cambiaTab('riepilogo'); 
        await caricaCronologia(com.id);

        document.getElementById('vista-elenco').classList.replace('flex', 'hidden');
        document.getElementById('vista-scheda').classList.replace('hidden', 'flex');
        window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err) { alert("Errore nell'apertura della commessa: " + err.message); }
}

function chiudiScheda() {
    commessaAttivaIndex = null;
    document.getElementById('vista-scheda').classList.replace('flex', 'hidden');
    document.getElementById('vista-elenco').classList.replace('hidden', 'flex');
    caricaCommesse(); 
}

function cambiaTab(tabName) {
    const tabs = ['riepilogo', 'preventivi', 'rilievi', 'contratti', 'ordini', 'posa', 'fatture'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-btn-${t}`);
        const cnt = document.getElementById(`tab-content-${t}`);
        if(btn) btn.className = "px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent transition-colors";
        if(cnt) cnt.className = "hidden";
    });
    document.getElementById(`tab-btn-${tabName}`).className = "px-4 py-2 text-sm font-semibold text-[#2e2a5b] border-b-2 border-[#2e2a5b] transition-colors";
    
    if (tabName === 'riepilogo') { document.getElementById('tab-content-riepilogo').className = "block space-y-6"; calcolaValoriEconomici(); } 
    else if (tabName === 'preventivi') { document.getElementById('tab-content-preventivi').className = "block space-y-4"; caricaPreventiviDiQuestaCommessa(); } 
    else if (tabName === 'rilievi') { document.getElementById('tab-content-rilievi').className = "block space-y-6"; caricaRilieviDiQuestaCommessa(); }
    else if (tabName === 'contratti') { document.getElementById('tab-content-contratti').className = "block space-y-4"; caricaContrattiDiQuestaCommessa(); } 
    else if (tabName === 'ordini') { document.getElementById('tab-content-ordini').className = "block space-y-4 flex flex-col h-full"; caricaOrdiniDiQuestaCommessa(); } 
    else if (tabName === 'posa') { document.getElementById('tab-content-posa').className = "block space-y-4"; caricaPosaInterventi(); } 
    else if (tabName === 'fatture') { document.getElementById('tab-content-fatture').className = "block space-y-4"; caricaFattureDiQuestaCommessa(); }
}

function creaPreventivoDaCommessa() { window.location.href = `preventivi.html?action=new&commessa_id=${commesseCorrenti[commessaAttivaIndex].id}`; }
function creaContrattoDaCommessa() { window.location.href = `contratti.html?action=new&commessa_id=${commesseCorrenti[commessaAttivaIndex].id}`; }
function creaFatturaDaCommessa() { window.location.href = `fatturazione.html?action=new&commessa_id=${commesseCorrenti[commessaAttivaIndex].id}`; }

// ================= GESTIONE VALORI ECONOMICI E RIEPILOGO =================
async function calcolaValoriEconomici() {
    const com = commesseCorrenti[commessaAttivaIndex];
    
    const { data: fatture } = await supabaseClient.from('fatture').select('importo, stato').eq('commessa_id', com.id);
    let totaleIncassato = 0;
    if(fatture) { fatture.forEach(f => { if(f.stato === 'Pagata' && f.importo) totaleIncassato += parseFloat(f.importo); }); }
    document.getElementById('scheda-incassato').innerText = formattaEuro(totaleIncassato);

    const { data: contratti } = await supabaseClient.from('contratti').select('valore_finale, stato').eq('commessa_id', com.id).neq('stato', 'Disdetto');
    let totaleContratti = 0;
    if(contratti && contratti.length > 0) { 
        contratti.forEach(c => { if(c.valore_finale) totaleContratti += parseFloat(c.valore_finale); }); 
    } else {
        const { data: preventivi } = await supabaseClient.from('preventivi').select('importo, stato').eq('commessa_id', com.id).neq('stato', 'Rifiutato');
        if(preventivi && preventivi.length > 0) { preventivi.forEach(p => { if(p.importo) totaleContratti += parseFloat(p.importo); }); }
    }
    document.getElementById('scheda-residuo').innerText = formattaEuro(totaleContratti);
    document.getElementById('scheda-sottotitolo-valore').innerText = formattaEuro(totaleContratti);

    const { data: ordini } = await supabaseClient.from('ordini_fornitori').select('costo_confermato').eq('commessa_id', com.id);
    let totaleCosti = 0;
    if(ordini) { ordini.forEach(o => { if(o.costo_confermato) totaleCosti += parseFloat(o.costo_confermato); }); }
    document.getElementById('scheda-sottotitolo-costi').innerText = formattaEuro(totaleCosti);
}

function aggiornaDatiSchedaUI() {
    if(commessaAttivaIndex === null) return;
    const com = commesseCorrenti[commessaAttivaIndex];
    document.getElementById('scheda-titolo').innerText = com.numero;
    
    const bdgSede = document.getElementById('scheda-badge-sede');
    if (com.sede_gestione) { bdgSede.innerText = com.sede_gestione; bdgSede.classList.remove('hidden'); } 
    else { bdgSede.classList.add('hidden'); }

    let colorStato = 'bg-blue-100 text-blue-800';
    if (com.stato === 'Conclusa') colorStato = 'bg-emerald-100 text-emerald-800 font-bold';
    if(com.stato === 'In Assistenza / Ripristino') colorStato = 'bg-orange-100 text-orange-800 border border-orange-300';
    if(com.stato === 'Contestazione') colorStato = 'bg-red-100 text-red-800 border border-red-300 animate-pulse';
    
    document.getElementById('scheda-badge-stato').className = `px-3 py-1 ${colorStato} rounded-full text-xs font-bold uppercase tracking-wider`;
    document.getElementById('scheda-badge-stato').innerText = com.stato || 'Preventivi';

    const nomeCliente = com.clienti ? com.clienti.nome_ragione_sociale : 'Sconosciuto';
    document.getElementById('scheda-sottotitolo-cliente').innerText = nomeCliente;
    document.getElementById('scheda-sottotitolo-cantiere').innerText = com.nome_cantiere || 'Nessun cantiere spec.';
    
    document.getElementById('scheda-sottotitolo-valore').innerText = "Calcolo in corso..."; 
    document.getElementById('scheda-sottotitolo-costi').innerText = "Calcolo in corso..."; 
    document.getElementById('data-nota-libera').value = new Date().toISOString().split('T')[0];

    disegnaStepperLed();
}

// ================= GESTIONE STEPPER LED =================
function disegnaStepperLed() {
    const com = commesseCorrenti[commessaAttivaIndex];
    const container = document.getElementById('stepper-container');
    container.innerHTML = '';
    
    let fasiArr = [0,0,0,0,0,0,0];
    if (com.fasi_cantiere) {
        let tempArr = com.fasi_cantiere.split(',').map(Number);
        if (tempArr.length === 6) tempArr.splice(2, 0, 0); 
        fasiArr = tempArr;
        while(fasiArr.length < 7) fasiArr.push(0);
    }
    ledStati = fasiArr;

    const bgLine = document.createElement('div');
    bgLine.className = 'absolute top-1/2 left-0 w-full h-1 bg-gray-200 -z-10 -translate-y-1/2 rounded-full';
    container.appendChild(bgLine);

    sequenzaStati.forEach((stato, index) => {
        const punto = document.createElement('div');
        punto.className = 'flex flex-col items-center gap-2 bg-white px-2 sm:px-4 z-10 cursor-pointer hover:scale-110 transition-transform';
        punto.onclick = () => gestisciClickLed(index); 
        
        let val = fasiArr[index] || 0;
        let iconaHTML = '';
        let textColor = 'text-gray-400';

        if (val === 0) {
            iconaHTML = `<div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-gray-50 text-gray-400 border border-gray-200">${index + 1}</div>`;
            textColor = 'text-gray-400';
        } else if (val === 1) { 
            iconaHTML = `<div class="w-8 h-8 rounded-full flex items-center justify-center bg-sky-500 text-white font-bold text-sm shadow-md ring-4 ring-sky-100">${index + 1}</div>`;
            textColor = 'text-sky-600 font-bold';
        } else if (val === 2) {
            iconaHTML = `<div class="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-500 text-white shadow-md text-sm font-bold ring-4 ring-emerald-100">✓</div>`;
            textColor = 'text-emerald-700 font-bold';
        }

        punto.innerHTML = `
            ${iconaHTML}
            <span class="text-[9px] sm:text-[11px] uppercase tracking-wider text-center w-16 sm:w-20 leading-tight ${textColor}">${stato}</span>
        `;
        container.appendChild(punto);
    });
}

async function gestisciClickLed(index) {
    let val = ledStati[index];
    if (val === 0) { await aggiornaLedDB(index, 1); } 
    else if (val === 1) {
        faseDaCompletare = index;
        document.getElementById('nome-fase-popup').innerText = sequenzaStati[index].toUpperCase();
        document.getElementById('modal-conferma-fase').classList.remove('hidden');
    } 
    else if (val === 2) {
        if(confirm(`Vuoi annullare il completamento della fase "${sequenzaStati[index]}" e riportarla a stato inattivo?`)) { await aggiornaLedDB(index, 0); }
    }
}

function chiudiModaleConfermaFase() {
    faseDaCompletare = null;
    document.getElementById('modal-conferma-fase').classList.add('hidden');
}

async function confermaFaseLed() {
    if (faseDaCompletare !== null) {
        await aggiornaLedDB(faseDaCompletare, 2);
        chiudiModaleConfermaFase();
    }
}

async function aggiornaLedDB(index, nuovoValore) {
    const com = commesseCorrenti[commessaAttivaIndex];
    let nuoviStati = [...ledStati];
    nuoviStati[index] = nuovoValore;
    const nuovaStringa = nuoviStati.join(',');
    
    let nuovoStatoTestuale = 'Preventivi';
    let found = false;
    for (let i = nuoviStati.length - 1; i >= 0; i--) {
        if (nuoviStati[i] > 0) {
            nuovoStatoTestuale = sequenzaStati[i];
            found = true;
            break;
        }
    }
    if (!found) nuovoStatoTestuale = 'Preventivi';

    const { error } = await supabaseClient.from('commesse').update({ fasi_cantiere: nuovaStringa, stato: nuovoStatoTestuale }).eq('id', com.id);

    if (!error) {
        let logMsg = '';
        if(nuovoValore === 1) logMsg = `🔹 Iniziata fase: ${sequenzaStati[index]}`;
        if(nuovoValore === 2) logMsg = `✅ Completata fase: ${sequenzaStati[index]}`;
        if(nuovoValore === 0) logMsg = `Resettata fase: ${sequenzaStati[index]}`;
        
        await supabaseClient.from('commesse_log').insert([{ commessa_id: com.id, azione: logMsg, autore: UTENTE_CORRENTE }]);
        
        com.fasi_cantiere = nuovaStringa;
        com.stato = nuovoStatoTestuale;
        ledStati = nuoviStati;
        
        aggiornaDatiSchedaUI();
        caricaCronologia(com.id);
    } else { alert("Errore aggiornamento fase: " + error.message); }
}

// ================= GESTIONE DIARIO / LOG =================
async function salvaNotaLibera() {
    const inputNota = document.getElementById('input-nota-libera'); 
    const dataNota = document.getElementById('data-nota-libera').value; 
    const testo = inputNota.value; 
    if (!testo || testo.trim() === '') return; 
    const comId = commesseCorrenti[commessaAttivaIndex].id;
    
    let timestamp = new Date().toISOString(); 
    if (dataNota && dataNota !== new Date().toISOString().split('T')[0]) { 
        timestamp = new Date(`${dataNota}T12:00:00Z`).toISOString(); 
    }
    const { error } = await supabaseClient.from('commesse_log').insert([{ 
        commessa_id: comId, 
        azione: "Comunicazione / Appunto Manuale", 
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
        const autoreText = log.autore ? `&bull; 👤 ${log.autore}` : '';
        const notaHtml = log.nota ? `<p class="text-sm text-gray-700 mt-2 bg-gray-50 p-2 rounded-lg border border-gray-100 shadow-inner">"${log.nota}"</p>` : '';
        const fileHtml = log.file_url ? `<a href="${log.file_url}" target="_blank" class="mt-2 inline-block px-3 py-1.5 bg-blue-50 text-blue-700 rounded text-xs font-bold border border-blue-100">📎 Apri Documento</a>` : '';
        
        let icona = '<div class="w-2.5 h-2.5 rounded-full bg-[#2e2a5b] mt-1.5 ring-4 ring-indigo-50"></div>';
        if (log.azione === "Comunicazione / Appunto Manuale") icona = '<div class="w-5 h-5 rounded flex items-center justify-center bg-emerald-100 text-emerald-600 text-xs ring-4 ring-emerald-50">💬</div>';
        if (log.azione.includes('Rilievo')) icona = '<div class="w-5 h-5 rounded flex items-center justify-center bg-blue-100 text-blue-700 text-xs ring-4 ring-blue-50">📐</div>';
        
        let iconaContainer = `<div class="cursor-pointer hover:scale-125 transition-transform" ondblclick="apriModaleModificaLog('${log.id}')" title="Doppio clic per modificare">${icona}</div>`;
        let pData = `<p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-[#2e2a5b] transition-colors" ondblclick="apriModaleModificaLog('${log.id}')" title="Doppio clic per modificare">${dataFormat} ${autoreText}</p>`;
        
        html += `<div class="flex gap-4 items-start pb-4 border-b border-gray-100 last:border-0 last:pb-0">${iconaContainer}<div class="flex-1"><div class="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-1"><p class="text-sm font-bold text-gray-900">${log.azione}</p>${pData}</div>${notaHtml}${fileHtml}</div></div>`;
    }); 
    divLog.innerHTML = html;
}

// ================= GESTIONE RILIEVI MISURE =================
async function caricaRilieviDiQuestaCommessa() {
    const com = commesseCorrenti[commessaAttivaIndex];
    const divLista = document.getElementById('lista-rilievi-commessa');
    divLista.innerHTML = '<p class="text-sm text-gray-500 italic py-2 text-center">Caricamento in corso...</p>';

    const { data: rilievi, error } = await supabaseClient.from('rilievi_misure').select('*').eq('commessa_id', com.id).order('data_rilievo', { ascending: false });

    const hasEsecutivo = rilievi && rilievi.some(r => r.tipo_rilievo === 'Rilievo Esecutive');
    const badgeStato = document.getElementById('rilievo-badge-stato');
    const containerStepper = document.getElementById('stepper-rilievo-container');

    if (hasEsecutivo) {
        badgeStato.innerText = 'Rilievo Eseguito'; badgeStato.className = 'px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold uppercase tracking-wider';
        containerStepper.innerHTML = `<div class="absolute top-1/2 left-0 w-full h-1 bg-emerald-200 -z-10 -translate-y-1/2 rounded-full"></div><div class="flex flex-col items-center gap-2 bg-white px-3 z-10"><div class="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-500 text-white shadow-md text-sm font-bold">✓</div><span class="text-xs uppercase tracking-wider text-gray-500">Da Fare</span></div><div class="flex flex-col items-center gap-2 bg-white px-3 z-10"><div class="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-600 text-white shadow-lg ring-4 ring-emerald-100 text-sm font-bold">✓</div><span class="text-xs font-bold uppercase tracking-wider text-emerald-700">Rilievo Eseguito</span></div>`;
    } else {
        badgeStato.innerText = 'Da Fare'; badgeStato.className = 'px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold uppercase tracking-wider';
        containerStepper.innerHTML = `<div class="absolute top-1/2 left-0 w-full h-1 bg-gray-200 -z-10 -translate-y-1/2 rounded-full"></div><div class="flex flex-col items-center gap-2 bg-white px-3 z-10"><div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-blue-500 text-white shadow-lg ring-4 ring-blue-100">1</div><span class="text-xs font-bold uppercase tracking-wider text-gray-900">Da Fare</span></div><div class="flex flex-col items-center gap-2 bg-white px-3 z-10"><div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-gray-100 text-gray-400 border-2 border-gray-200">2</div><span class="text-xs uppercase tracking-wider text-gray-400">Rilievo Eseguito</span></div>`;
    }

    if (error) { divLista.innerHTML = '<p class="text-sm text-red-500">Errore DB.</p>'; return; }
    if (!rilievi || rilievi.length === 0) { divLista.innerHTML = '<p class="text-sm text-gray-500 italic py-4 text-center">Nessuna attività registrata. Clicca su "+ Nuovo Rilievo" per iniziare.</p>'; return; }

    let html = '';
    rilievi.forEach(ril => {
        const dataSplit = ril.data_rilievo ? ril.data_rilievo.split('-') : ['','','']; 
        const dataIta = ril.data_rilievo ? `${dataSplit[2]}/${dataSplit[1]}/${dataSplit[0]}` : '--';
        const tipo = ril.tipo_rilievo || 'Rilievo Misure';
        
        let colorBadge = 'bg-gray-100 text-gray-700';
        if (tipo === 'Rilievo Esecutive') colorBadge = 'bg-emerald-100 text-emerald-800';
        if (tipo === 'Rilievo Preventivo') colorBadge = 'bg-blue-100 text-blue-800';
        if (tipo === 'Ricontrollo') colorBadge = 'bg-orange-100 text-orange-800';

        const note = ril.note ? `<p class="text-sm text-gray-700 mt-2 bg-gray-50 p-2 rounded">${ril.note}</p>` : ''; 
        const btnFile = ril.file_url ? `<a href="${ril.file_url}" target="_blank" class="mt-2 inline-block px-3 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-bold border border-indigo-100">📎 Apri Allegato</a>` : '';
        
        html += `<div class="p-4 bg-white border border-gray-200 rounded-xl shadow-sm mb-3"><div class="flex justify-between items-start"><div><span class="font-bold text-gray-900 text-lg">📅 ${dataIta}</span><span class="ml-2 px-2 py-0.5 ${colorBadge} rounded-full text-xs font-bold">${tipo}</span><span class="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-bold">👤 ${ril.tecnico || '--'}</span></div><button onclick="eliminaRilievo(${ril.id})" class="text-red-400 hover:text-red-600 font-bold text-xl leading-none">&times;</button></div>${note} ${btnFile}</div>`;
    });
    divLista.innerHTML = html;
}

function apriModaleRilievo() { document.getElementById('form-rilievo-misure').reset(); document.getElementById('rilievo-input-data').value = new Date().toISOString().split('T')[0]; document.getElementById('rilievo-input-tecnico').value = UTENTE_CORRENTE; document.getElementById('modal-rilievo-misure').classList.remove('hidden'); }
function chiudiModaleRilievo() { document.getElementById('modal-rilievo-misure').classList.add('hidden'); }
async function eliminaRilievo(id) { if(!confirm("Vuoi eliminare questa registrazione di rilievo?")) return; await supabaseClient.from('rilievi_misure').delete().eq('id', id); caricaRilieviDiQuestaCommessa(); }

// ================= PREVENTIVI E CONTRATTI =================
async function caricaPreventiviDiQuestaCommessa() {
    const com = commesseCorrenti[commessaAttivaIndex];
    const divLista = document.getElementById('lista-preventivi-commessa');
    divLista.innerHTML = '<p class="text-sm text-gray-500">Caricamento in corso...</p>';
    const { data: preventivi, error } = await supabaseClient.from('preventivi').select('*').eq('commessa_id', com.id).order('created_at', { ascending: false });
    if (error) { divLista.innerHTML = '<p class="text-sm text-red-500">Errore caricamento preventivi.</p>'; return; }
    if (!preventivi || preventivi.length === 0) { divLista.innerHTML = '<div class="p-6 bg-gray-50 border border-dashed border-gray-300 rounded-xl text-center"><p class="text-sm text-gray-500">Nessun preventivo associato a questa commessa.</p></div>'; return; }

    let html = '';
    preventivi.forEach(prev => {
        const importo = prev.importo ? formattaEuro(prev.importo) : '--';
        const data
