const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// BASE DE DONNÉES
// ============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS traiteurs (
      id SERIAL PRIMARY KEY,
      nom_boutique VARCHAR(100) NOT NULL,
      proprietaire VARCHAR(100),
      whatsapp VARCHAR(20) UNIQUE NOT NULL,
      ville VARCHAR(50) DEFAULT 'Dakar',
      type_cuisine VARCHAR(50) DEFAULT 'sénégalaise',
      type_compte VARCHAR(20) DEFAULT 'traiteur',
      plan VARCHAR(20) DEFAULT 'gratuit',
      pin VARCHAR(10),
      actif BOOLEAN DEFAULT true,
      referral_code VARCHAR(20),
      logo_emoji VARCHAR(10) DEFAULT '🍽️',
      description TEXT,
      zone_livraison TEXT,
      frais_livraison INTEGER DEFAULT 0,
      min_commande INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS menus (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      nom VARCHAR(100) NOT NULL,
      description TEXT,
      prix INTEGER NOT NULL,
      categorie VARCHAR(50) DEFAULT 'plat',
      emoji VARCHAR(10) DEFAULT '🍽️',
      nb_personnes INTEGER DEFAULT 1,
      disponible BOOLEAN DEFAULT true,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS commandes_traiteur (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      client_phone VARCHAR(20) NOT NULL,
      client_nom VARCHAR(100),
      items JSONB DEFAULT '[]',
      total INTEGER DEFAULT 0,
      statut VARCHAR(30) DEFAULT 'nouveau',
      adresse_livraison TEXT,
      date_livraison TIMESTAMP,
      nb_personnes INTEGER DEFAULT 1,
      notes TEXT,
      reference VARCHAR(20),
      frais_livraison INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clients_traiteur (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      phone VARCHAR(20) NOT NULL,
      nom VARCHAR(100),
      nb_commandes INTEGER DEFAULT 0,
      total_depense INTEGER DEFAULT 0,
      derniere_commande TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(traiteur_id, phone)
    );
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS seuil_commandes INTEGER DEFAULT 30;
    ALTER TABLE commandes_traiteur ADD COLUMN IF NOT EXISTS livreur_id INTEGER DEFAULT NULL;
  `);

  // Traiteur démo
  await pool.query(`
    INSERT INTO traiteurs (id, nom_boutique, proprietaire, whatsapp, ville, type_cuisine, plan, referral_code, logo_emoji, description, zone_livraison)
    VALUES (1, 'Chez Fatou Traiteur', 'Fatou Diallo', '221771234567', 'Dakar', 'sénégalaise', 'pro', 'FATOUTP1', '🍲', 'Spécialiste thiéboudienne, yassa et mafé depuis 15 ans', 'Dakar, Plateau, Médina')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Menus démo
  await pool.query(`
    INSERT INTO menus (traiteur_id, nom, description, prix, categorie, emoji, nb_personnes) VALUES
    (1, 'Thiéboudienne', 'Riz au poisson avec légumes frais', 5000, 'plat', '🍚', 1),
    (1, 'Yassa Poulet', 'Poulet mariné à la moutarde et oignon', 4500, 'plat', '🍗', 1),
    (1, 'Mafé', 'Ragoût à la pâte d''arachide', 4000, 'plat', '🥘', 1),
    (1, 'Thiéboudienne Familialt', 'Pour 10 personnes', 45000, 'famille', '🍚', 10),
    (1, 'Buffet Mariage', 'Menu complet 50 personnes + service', 250000, 'evenement', '🎊', 50),
    (1, 'Plateau Cantine', 'Plat du jour + boisson (entreprises)', 3500, 'cantine', '🥡', 1)
    ON CONFLICT DO NOTHING;
  `);

  console.log('✅ TraiteurPro DB initialisée');
}

// ============================================
// HELPERS
// ============================================
async function envoyerWhatsApp(phone_id, to, message) {
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${phone_id}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } })
    });
    const d = await r.json();
    if (!r.ok) console.error('WhatsApp error:', JSON.stringify(d));
    return d;
  } catch(e) { console.error('envoyerWhatsApp:', e.message); }
}

const adminMiddleware = (req, res, next) => {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Non autorisé' });
  next();
};

// Générer référence
function genRef() {
  return 'TR-' + Date.now().toString(36).toUpperCase();
}

// Parser commande IA
async function parserCommandeIA(texte, menus) {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'system',
          content: `Tu es un assistant pour un traiteur sénégalais. 
          Extrait les informations de commande du message.
          Menus disponibles: ${JSON.stringify(menus.map(m => ({ nom: m.nom, prix: m.prix, emoji: m.emoji, nb_personnes: m.nb_personnes })))}
          Réponds UNIQUEMENT en JSON:
          {"items": [{"nom": "...", "quantite": 1, "prix": 0}], "nb_personnes": 1, "date_livraison": null, "notes": ""}
          Si ce n'est pas une commande, réponds: {"intent": "autre", "message": "ta réponse en français"}`
        }, { role: 'user', content: texte }],
        max_tokens: 300,
        temperature: 0.1
      })
    });
    const d = await r.json();
    const content = d.choices?.[0]?.message?.content || '{}';
    return JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch(e) { return { intent: 'autre', message: 'Je n\'ai pas compris. Que souhaitez-vous commander ?' }; }
}

// ============================================
// ÉTAT BOT (RAM)
// ============================================
const pendingAddress = {};   // phone → { items, total, traiteur_id, nb_personnes }
const pendingDate = {};      // phone → { items, total, adresse, traiteur_id }
const clientTraiteurMap = {}; // phone client → traiteur_id

// ============================================
// WEBHOOK WHATSAPP
// ============================================
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN && req.query['hub.challenge']) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return res.sendStatus(404);
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const phone = msg.from;
    const phone_id = change.metadata.phone_number_id;
    const texte = msg.text?.body?.trim() || '';

    // Identifier le traiteur
    let traiteur_id = clientTraiteurMap[phone];
    if (!traiteur_id) {
      const r = await pool.query('SELECT id FROM traiteurs WHERE actif=true LIMIT 1');
      if (r.rows[0]) { traiteur_id = r.rows[0].id; clientTraiteurMap[phone] = traiteur_id; }
    }
    const traiteurRes = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [traiteur_id]);
    const traiteur = traiteurRes.rows[0];
    if (!traiteur) return res.sendStatus(200);

    const menusRes = await pool.query('SELECT * FROM menus WHERE traiteur_id=$1 AND disponible=true ORDER BY categorie, prix', [traiteur_id]);
    const menus = menusRes.rows;

    // ---- ÉTAPE 3 : Attente date livraison
    if (pendingDate[phone]) {
      const { items, total, adresse } = pendingDate[phone];
      let dateLivraison = null;
      const txt = texte.toLowerCase();
      if (txt.includes('demain')) { dateLivraison = new Date(); dateLivraison.setDate(dateLivraison.getDate()+1); }
      else if (txt.includes('aujourd')) { dateLivraison = new Date(); }
      else if (txt.match(/\d{1,2}[\/\-]\d{1,2}/)) { dateLivraison = new Date(texte); }
      else { dateLivraison = new Date(); dateLivraison.setDate(dateLivraison.getDate()+1); }

      delete pendingDate[phone];
      const ref = genRef();
      const r = await pool.query(
        `INSERT INTO commandes_traiteur (traiteur_id, client_phone, items, total, adresse_livraison, date_livraison, reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [traiteur_id, phone, JSON.stringify(items), total, adresse, dateLivraison, ref]
      );

      // Mettre à jour client
      await pool.query(`
        INSERT INTO clients_traiteur (traiteur_id, phone, nb_commandes, total_depense, derniere_commande)
        VALUES ($1,$2,1,$3,NOW())
        ON CONFLICT (traiteur_id, phone) DO UPDATE SET
        nb_commandes=clients_traiteur.nb_commandes+1,
        total_depense=clients_traiteur.total_depense+$3,
        derniere_commande=NOW()
      `, [traiteur_id, phone, total]);

      const dateStr = dateLivraison ? dateLivraison.toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long'}) : 'Demain';
      await envoyerWhatsApp(phone_id, phone,
        `✅ *Commande confirmée !*\n\nRéférence : *${ref}*\n📍 Livraison : ${adresse}\n📅 Date : ${dateStr}\n💰 Total : *${total.toLocaleString('fr-FR')} FCFA*\n\nNous préparons votre commande avec amour 🍽️\n\n_${traiteur.nom_boutique} · TraiteurPro 🇸🇳_`
      );

      // Notifier traiteur
      if (traiteur.whatsapp) {
        const produits = items.map(i => `• ${i.quantite}x ${i.nom}`).join('\n');
        await envoyerWhatsApp(phone_id, traiteur.whatsapp,
          `🍽️ *Nouvelle commande !*\n\nRéf : *${ref}*\n👤 Client : ${phone}\n📍 ${adresse}\n📅 ${dateStr}\n\n${produits}\n\n💰 Total : *${total.toLocaleString('fr-FR')} FCFA*`
        );
      }
      return res.sendStatus(200);
    }

    // ---- ÉTAPE 2 : Attente adresse
    if (pendingAddress[phone]) {
      const { items, total, traiteur_id: tid } = pendingAddress[phone];
      const adresse = texte;
      delete pendingAddress[phone];
      pendingDate[phone] = { items, total, adresse, traiteur_id: tid };
      await envoyerWhatsApp(phone_id, phone,
        `📅 *Pour quand souhaitez-vous la livraison ?*\n\n(Ex: "demain", "vendredi", "15/03")`
      );
      return res.sendStatus(200);
    }

    // ---- MENU DU JOUR
    if (/menu|carte|plat|manger|commander|quoi|disponible/i.test(texte)) {
      const categories = { plat: '🍽️ Plats', famille: '👨‍👩‍👧 Formules Famille', evenement: '🎊 Événements', cantine: '🏢 Cantine Entreprise' };
      let msg = `🍽️ *Menu — ${traiteur.nom_boutique}*\n\n`;
      const grouped = {};
      menus.forEach(m => { if (!grouped[m.categorie]) grouped[m.categorie] = []; grouped[m.categorie].push(m); });
      for (const [cat, items] of Object.entries(grouped)) {
        msg += `*${categories[cat] || cat}*\n`;
        items.forEach(m => { msg += `${m.emoji} ${m.nom} — *${m.prix.toLocaleString('fr-FR')} FCFA*${m.nb_personnes > 1 ? ` (${m.nb_personnes} pers.)` : ''}\n`; });
        msg += '\n';
      }
      msg += `📲 Envoyez votre commande directement !\nEx: _"Je veux 2 thiéboudiennes"_\n\n_${traiteur.zone_livraison ? '📍 Livraison : '+traiteur.zone_livraison : ''}_`;
      await envoyerWhatsApp(phone_id, phone, msg);
      return res.sendStatus(200);
    }

    // ---- STATUT COMMANDE
    if (/statut|commande|suivi|où en|mon repas/i.test(texte)) {
      const r = await pool.query(
        'SELECT * FROM commandes_traiteur WHERE client_phone=$1 AND traiteur_id=$2 ORDER BY created_at DESC LIMIT 1',
        [phone, traiteur_id]
      );
      if (r.rows[0]) {
        const c = r.rows[0];
        const statuts = { nouveau:'🕐 En attente', confirmé:'✅ Confirmée', preparation:'👨‍🍳 En préparation', 'en route':'🚚 En route', livré:'✅ Livrée', annulé:'❌ Annulée' };
        await envoyerWhatsApp(phone_id, phone,
          `📋 *Votre dernière commande*\n\nRéf : *${c.reference}*\nStatut : ${statuts[c.statut] || c.statut}\n💰 Total : ${Number(c.total).toLocaleString('fr-FR')} FCFA\n\n_${traiteur.nom_boutique} · TraiteurPro 🇸🇳_`
        );
      } else {
        await envoyerWhatsApp(phone_id, phone, `Vous n'avez pas encore de commande chez ${traiteur.nom_boutique} 🍽️\n\nEnvoyez "menu" pour voir nos plats !`);
      }
      return res.sendStatus(200);
    }

    // ---- PARSER COMMANDE IA
    const parsed = await parserCommandeIA(texte, menus);

    if (parsed.intent === 'autre' || !parsed.items?.length) {
      await envoyerWhatsApp(phone_id, phone,
        parsed.message || `Bonjour ! 👋\n\nBienvenue chez *${traiteur.nom_boutique}* 🍽️\n\nEnvoyez *"menu"* pour voir nos plats\nOu commandez directement : _"Je veux 2 thiéboudiennes"_`
      );
      return res.sendStatus(200);
    }

    // Calculer total
    let total = 0;
    const itemsAvecPrix = parsed.items.map(item => {
      const menu = menus.find(m => m.nom.toLowerCase().includes(item.nom.toLowerCase()) || item.nom.toLowerCase().includes(m.nom.toLowerCase().split(' ')[0]));
      const prix = menu?.prix || item.prix || 0;
      total += prix * (item.quantite || 1);
      return { nom: menu?.nom || item.nom, quantite: item.quantite || 1, prix, emoji: menu?.emoji || '🍽️' };
    });

    // Confirmation + demande adresse
    let confirm = `🛒 *Récapitulatif de votre commande*\n\n`;
    itemsAvecPrix.forEach(i => { confirm += `${i.emoji} ${i.quantite}x ${i.nom} — ${(i.prix*i.quantite).toLocaleString('fr-FR')} FCFA\n`; });
    confirm += `\n💰 Total : *${total.toLocaleString('fr-FR')} FCFA*\n`;
    if (traiteur.frais_livraison > 0) confirm += `🚚 Livraison : *${traiteur.frais_livraison.toLocaleString('fr-FR')} FCFA*\n`;
    confirm += `\n📍 *Quelle est votre adresse de livraison ?*`;

    pendingAddress[phone] = { items: itemsAvecPrix, total, traiteur_id };
    await envoyerWhatsApp(phone_id, phone, confirm);
    return res.sendStatus(200);

  } catch(e) {
    console.error('Webhook error:', e.message);
    res.sendStatus(200);
  }
});

// ============================================
// API TRAITEURS
// ============================================
app.get('/api/traiteurs', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, nom_boutique, proprietaire, ville, type_cuisine, plan, logo_emoji, description, zone_livraison FROM traiteurs WHERE actif=true ORDER BY nom_boutique');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dashboard/:traiteur_id', async (req, res) => {
  try {
    const id = req.params.traiteur_id;
    const [cmds, revenus, clients, newCmds] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM commandes_traiteur WHERE traiteur_id=$1', [id]),
      pool.query('SELECT COALESCE(SUM(total),0) as total FROM commandes_traiteur WHERE traiteur_id=$1', [id]),
      pool.query('SELECT COUNT(DISTINCT client_phone) FROM commandes_traiteur WHERE traiteur_id=$1', [id]),
      pool.query("SELECT COUNT(*) FROM commandes_traiteur WHERE traiteur_id=$1 AND statut='nouveau'", [id])
    ]);
    const semaine = await pool.query(`
      SELECT DATE_TRUNC('day', created_at) as jour, SUM(total) as revenus, COUNT(*) as nb
      FROM commandes_traiteur WHERE traiteur_id=$1 AND created_at > NOW()-INTERVAL '7 days'
      GROUP BY jour ORDER BY jour`, [id]);
    const platsTop = await pool.query(`
      SELECT item->>'nom' as nom, item->>'emoji' as emoji, SUM((item->>'quantite')::int) as total
      FROM commandes_traiteur, jsonb_array_elements(items) as item
      WHERE traiteur_id=$1 GROUP BY nom, emoji ORDER BY total DESC LIMIT 5`, [id]);
    res.json({
      kpis: {
        commandes: parseInt(cmds.rows[0].count),
        revenus: parseInt(revenus.rows[0].total),
        clients: parseInt(clients.rows[0].count),
        nouvelles: parseInt(newCmds.rows[0].count)
      },
      semaine: semaine.rows,
      plats_top: platsTop.rows
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// API MENUS
// ============================================
app.get('/api/menus/:traiteur_id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM menus WHERE traiteur_id=$1 ORDER BY categorie, prix', [req.params.traiteur_id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/menus', async (req, res) => {
  try {
    const { traiteur_id, nom, description, prix, categorie, emoji, nb_personnes } = req.body;
    const r = await pool.query(
      'INSERT INTO menus (traiteur_id, nom, description, prix, categorie, emoji, nb_personnes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [traiteur_id, nom, description, prix, categorie||'plat', emoji||'🍽️', nb_personnes||1]
    );
    res.json({ ok: true, menu: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/menus/:id', async (req, res) => {
  try {
    const { nom, description, prix, categorie, emoji, disponible } = req.body;
    const r = await pool.query(
      'UPDATE menus SET nom=COALESCE($1,nom), description=COALESCE($2,description), prix=COALESCE($3,prix), categorie=COALESCE($4,categorie), emoji=COALESCE($5,emoji), disponible=COALESCE($6,disponible) WHERE id=$7 RETURNING *',
      [nom, description, prix, categorie, emoji, disponible, req.params.id]
    );
    res.json({ ok: true, menu: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/menus/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM menus WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// API COMMANDES
// ============================================
app.get('/api/commandes/:traiteur_id', async (req, res) => {
  try {
    const { statut, limit } = req.query;
    let q = 'SELECT * FROM commandes_traiteur WHERE traiteur_id=$1';
    const params = [req.params.traiteur_id];
    if (statut) { q += ` AND statut=$${params.length+1}`; params.push(statut); }
    q += ' ORDER BY created_at DESC LIMIT ' + (limit || 50);
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/commandes/:id', async (req, res) => {
  try {
    const { statut, traiteur_id } = req.body;
    const r = await pool.query('UPDATE commandes_traiteur SET statut=$1 WHERE id=$2 RETURNING *', [statut, req.params.id]);
    const cmd = r.rows[0];
    if (!cmd) return res.status(404).json({ error: 'Commande introuvable' });

    // Notifier client
    const traiteurRes = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [cmd.traiteur_id]);
    const t = traiteurRes.rows[0];
    const msgs = {
      confirmé: `✅ *Commande confirmée !*\n\nRéf : *${cmd.reference}*\nNous allons préparer votre commande 👨‍🍳\n\n_${t?.nom_boutique}_`,
      preparation: `👨‍🍳 *Votre repas est en préparation !*\n\nRéf : *${cmd.reference}*\nTemps estimé : 30-45 min ⏱️\n\n_${t?.nom_boutique}_`,
      'en route': `🚚 *Votre commande est en route !*\n\nRéf : *${cmd.reference}*\nVotre livreur arrive bientôt 🛵\n\n_${t?.nom_boutique}_`,
      livré: `🎉 *Bon appétit !*\n\nRéf : *${cmd.reference}*\nVotre commande a été livrée ✅\n\nDonnez-nous votre avis :\n⭐ 1 = Pas satisfait\n⭐⭐⭐ 3 = Bien\n⭐⭐⭐⭐⭐ 5 = Excellent !\n\n_${t?.nom_boutique} · Merci 🙏_`,
      annulé: `❌ *Commande annulée*\n\nRéf : *${cmd.reference}*\nNous sommes désolés.\nContactez-nous pour plus d'infos.\n\n_${t?.nom_boutique}_`
    };
    if (msgs[statut]) await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, cmd.client_phone, msgs[statut]);
    res.json(cmd);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Commande manuelle (dashboard)
app.post('/api/commandes', async (req, res) => {
  try {
    const { traiteur_id, client_phone, client_nom, items, total, adresse_livraison, date_livraison, notes } = req.body;
    const ref = genRef();
    const r = await pool.query(
      `INSERT INTO commandes_traiteur (traiteur_id, client_phone, client_nom, items, total, adresse_livraison, date_livraison, notes, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [traiteur_id, client_phone, client_nom, JSON.stringify(items||[]), total||0, adresse_livraison, date_livraison, notes, ref]
    );
    res.json({ ok: true, commande: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// API CLIENTS
// ============================================
app.get('/api/clients/:traiteur_id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM clients_traiteur WHERE traiteur_id=$1 ORDER BY total_depense DESC', [req.params.traiteur_id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Promo flash à tous les clients
app.post('/api/promo/:traiteur_id', async (req, res) => {
  try {
    const { message } = req.body;
    const traiteur = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [req.params.traiteur_id]);
    const t = traiteur.rows[0];
    const clients = await pool.query('SELECT DISTINCT client_phone FROM commandes_traiteur WHERE traiteur_id=$1', [req.params.traiteur_id]);
    const phone_id = process.env.PHONE_NUMBER_ID;
    let envoyes = 0;
    for (const c of clients.rows) {
      await envoyerWhatsApp(phone_id, c.client_phone, `🍽️ *${t.nom_boutique}*\n\n${message}\n\n_TraiteurPro 🇸🇳_`);
      envoyes++;
    }
    res.json({ ok: true, envoyes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Relance clients inactifs (7j)
app.get('/api/relances/:traiteur_id', adminMiddleware, async (req, res) => {
  try {
    const traiteur = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [req.params.traiteur_id]);
    const t = traiteur.rows[0];
    const clients = await pool.query(`
      SELECT * FROM clients_traiteur
      WHERE traiteur_id=$1 AND derniere_commande < NOW()-INTERVAL '7 days'`, [req.params.traiteur_id]);
    const phone_id = process.env.PHONE_NUMBER_ID;
    let envoyes = 0;
    for (const c of clients.rows) {
      const msg = `🍽️ *${t.nom_boutique} vous manque !*\n\nBonjour ${c.nom || ''}👋\n\nCela fait un moment que vous n'avez pas commandé chez nous.\n\nEnvoyez *"menu"* pour voir nos plats du jour 😊\n\n_${t.nom_boutique} · TraiteurPro 🇸🇳_`;
      await envoyerWhatsApp(phone_id, c.phone, msg);
      envoyes++;
    }
    res.json({ ok: true, envoyes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// LOGIN PIN
// ============================================
app.post('/api/traiteur/login', async (req, res) => {
  try {
    const { traiteur_id, pin } = req.body;
    const r = await pool.query('SELECT id, nom_boutique, pin, plan FROM traiteurs WHERE id=$1', [traiteur_id]);
    const t = r.rows[0];
    if (!t) return res.status(404).json({ error: 'Traiteur introuvable' });
    const defaultPin = '1234';
    const validPin = t.pin || defaultPin;
    if (pin !== validPin) return res.status(401).json({ error: 'PIN incorrect' });
    const firstLogin = !t.pin;
    res.json({ ok: true, traiteur_id: t.id, nom: t.nom_boutique, plan: t.plan, first_login: firstLogin });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/traiteur/set-pin', async (req, res) => {
  try {
    const { traiteur_id, ancien_pin, nouveau_pin } = req.body;
    const r = await pool.query('SELECT pin FROM traiteurs WHERE id=$1', [traiteur_id]);
    const t = r.rows[0];
    if (!t) return res.status(404).json({ error: 'Traiteur introuvable' });
    if (t.pin && t.pin !== ancien_pin) return res.status(401).json({ error: 'Ancien PIN incorrect' });
    await pool.query('UPDATE traiteurs SET pin=$1 WHERE id=$2', [nouveau_pin, traiteur_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/reset-pin-traiteur', adminMiddleware, async (req, res) => {
  try {
    const { traiteur_id, nouveau_pin } = req.body;
    await pool.query('UPDATE traiteurs SET pin=$1 WHERE id=$2', [nouveau_pin, traiteur_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// INSCRIPTION TRAITEUR
// ============================================
app.post('/api/inscription', async (req, res) => {
  try {
    const { nom_boutique, proprietaire, whatsapp, ville, type_cuisine, description, zone_livraison } = req.body;
    if (!nom_boutique || !whatsapp) return res.status(400).json({ error: 'Données manquantes' });
    const wa = whatsapp.replace(/\D/g, '');
    const ref = 'TP' + Math.random().toString(36).substring(2,7).toUpperCase();
    const r = await pool.query(
      `INSERT INTO traiteurs (nom_boutique, proprietaire, whatsapp, ville, type_cuisine, plan, referral_code, description, zone_livraison)
       VALUES ($1,$2,$3,$4,$5,'gratuit',$6,$7,$8) RETURNING *`,
      [nom_boutique, proprietaire||'', wa, ville||'Dakar', type_cuisine||'sénégalaise', ref, description, zone_livraison]
    );
    const t = r.rows[0];
    // Bienvenue
    const msg = `🍽️ *Bienvenue sur TraiteurPro !*\n\nBonjour ${proprietaire||nom_boutique} 👋\n\nVotre espace traiteur est actif !\n\n🔗 Dashboard : traiteurpro-production.up.railway.app/app\n🆔 Votre ID : ${t.id}\n🔐 PIN par défaut : 1234\n\n_TraiteurPro · Terangaprestige Group 🇸🇳_`;
    await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, wa, msg);
    res.json({ ok: true, traiteur: t });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// ROUTES ADMIN
// ============================================

// Stats globales
app.get('/api/admin/stats', adminMiddleware, async (req, res) => {
  try {
    const [traiteurs, commandes, clients, actifs, plans] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM traiteurs'),
      pool.query('SELECT COUNT(*) FROM commandes_traiteur'),
      pool.query('SELECT COUNT(DISTINCT client_phone) FROM commandes_traiteur'),
      pool.query('SELECT COUNT(*) FROM traiteurs WHERE actif=true'),
      pool.query('SELECT plan, COUNT(*) as nb FROM traiteurs GROUP BY plan')
    ]);
    const plansMap = {};
    plans.rows.forEach(p => { plansMap[p.plan] = parseInt(p.nb); });
    res.json({
      traiteurs: parseInt(traiteurs.rows[0].count),
      commandes: parseInt(commandes.rows[0].count),
      clients: parseInt(clients.rows[0].count),
      actifs: parseInt(actifs.rows[0].count),
      plans: plansMap
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Liste tous les traiteurs avec stats
app.get('/api/admin/traiteurs', adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT t.*, 
        COUNT(c.id) as nb_commandes,
        COALESCE(SUM(c.total),0) as revenus
      FROM traiteurs t
      LEFT JOIN commandes_traiteur c ON c.traiteur_id = t.id
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Modifier un traiteur
app.put('/api/admin/traiteur/:id', adminMiddleware, async (req, res) => {
  try {
    const { plan, actif, pin } = req.body;
    let q = 'UPDATE traiteurs SET plan=COALESCE($1,plan), actif=COALESCE($2,actif)';
    const params = [plan, actif];
    if (pin) { q += `, pin=$${params.length+1}`; params.push(pin); }
    q += ` WHERE id=$${params.length+1} RETURNING *`;
    params.push(req.params.id);
    const r = await pool.query(q, params);
    res.json({ ok: true, traiteur: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Activité récente (7 jours)
app.get('/api/admin/activite', adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT t.nom_boutique, t.whatsapp,
        COUNT(c.id) as nb,
        COALESCE(SUM(c.total),0) as revenus,
        MAX(c.created_at) as created_at
      FROM commandes_traiteur c
      JOIN traiteurs t ON t.id = c.traiteur_id
      WHERE c.created_at > NOW()-INTERVAL '7 days'
      GROUP BY t.id, t.nom_boutique, t.whatsapp
      ORDER BY created_at DESC
      LIMIT 20
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Envoyer message WhatsApp à un traiteur
app.post('/api/admin/message', adminMiddleware, async (req, res) => {
  try {
    const { phone, message } = req.body;
    await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, phone, message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// PAGES
// ============================================
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/inscription', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inscription.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));

// ============================================
// CRONS
// ============================================
function planifierRelances() {
  // Relances quotidiennes 10h
  const now = new Date();
  const demain = new Date(now);
  demain.setDate(now.getDate() + (now.getHours() >= 10 ? 1 : 0));
  demain.setHours(10, 0, 0, 0);
  setTimeout(() => {
    console.log('📲 Relances automatiques TraiteurPro...');
    setInterval(() => console.log('📲 Relances...'), 24*60*60*1000);
  }, demain - now);
}

// ============================================
// DÉMARRAGE
// ============================================
initDB().then(() => {
  app.listen(process.env.PORT || 3001, () => {
    console.log('🍽️ TraiteurPro v1.0 démarré sur port ' + (process.env.PORT || 3001));
    planifierRelances();
  });
}).catch(err => console.error('Erreur démarrage:', err));
