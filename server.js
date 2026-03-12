const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route menu public — DOIT être après static pour éviter conflit
app.get('/menu/:traiteur_id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'menu-public.html'));
});

// ============================================
// BASE DE DONNÉES
// ============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER,
      subscription JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
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
      essai_expire TIMESTAMP,
      parrain_id INTEGER,
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

app.get('/api/admin/activer', async (req, res) => {
  const { secret, traiteur_id } = req.query;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('UPDATE traiteurs SET actif=true WHERE id=$1', [traiteur_id]);
  res.json({ ok: true, message: `Traiteur ${traiteur_id} activé` });
});

app.get('/api/admin/reset-pin', async (req, res) => {
  const { secret, traiteur_id, pin } = req.query;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Accès refusé' });
  if (!traiteur_id || !pin) return res.json({ error: 'traiteur_id et pin requis' });
  await pool.query('UPDATE traiteurs SET pin=$1 WHERE id=$2', [pin, traiteur_id]);
  res.json({ ok: true, message: `PIN du traiteur ${traiteur_id} réinitialisé à ${pin}` });
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
    const { nom_boutique, proprietaire, whatsapp, ville, type_cuisine, description, zone_livraison, parrain_code } = req.body;
    if (!nom_boutique || !whatsapp) return res.status(400).json({ error: 'Données manquantes' });
    const wa = whatsapp.replace(/\D/g, '');
    const ref = 'TP' + Math.random().toString(36).substring(2,7).toUpperCase();

    // Essai 14 jours
    const essaiExpire = new Date();
    essaiExpire.setDate(essaiExpire.getDate() + 14);

    // Parrainage
    let parrainId = null;
    if (parrain_code) {
      const parrain = await pool.query('SELECT id FROM traiteurs WHERE referral_code=$1', [parrain_code.toUpperCase()]);
      if (parrain.rows.length > 0) parrainId = parrain.rows[0].id;
    }

    const r = await pool.query(
      `INSERT INTO traiteurs (nom_boutique, proprietaire, whatsapp, ville, type_cuisine, plan, referral_code, description, zone_livraison, essai_expire, parrain_id)
       VALUES ($1,$2,$3,$4,$5,'starter',$6,$7,$8,$9,$10) RETURNING *`,
      [nom_boutique, proprietaire||'', wa, ville||'Dakar', type_cuisine||'sénégalaise', ref, description, zone_livraison, essaiExpire, parrainId]
    );
    const t = r.rows[0];

    // Si parrainage valide → offrir 1 mois au parrain
    if (parrainId) {
      await pool.query(`
        UPDATE traiteurs SET abonnement_expire = COALESCE(abonnement_expire, NOW()) + INTERVAL '1 month'
        WHERE id=$1
      `, [parrainId]);
      const parrain = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [parrainId]);
      if (parrain.rows[0]) {
        const msgParrain = `🎉 *Bonne nouvelle !*\n\nVotre filleul *${nom_boutique}* vient de s'inscrire sur TraiteurPro !\n\n🎁 Vous gagnez *1 mois offert* sur votre abonnement !\n\nMerci de nous recommander 🙏\n\n_TraiteurPro 🇸🇳_`;
        await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, parrain.rows[0].whatsapp, msgParrain);
      }
    }

    // Message bienvenue avec essai
    const msg = `🍽️ *Bienvenue sur TraiteurPro !*\n\nBonjour ${proprietaire||nom_boutique} 👋\n\n✅ Votre essai *Starter gratuit* est activé pour *14 jours* !\n\n🔗 Dashboard : https://traiteurpro-production.up.railway.app/app?id=${t.id}\n🔐 PIN par défaut : 1234\n📅 Essai jusqu'au : ${essaiExpire.toLocaleDateString('fr-FR')}\n\n💡 *3 étapes pour démarrer :*\n1️⃣ Connectez-vous avec votre PIN\n2️⃣ Ajoutez vos plats au menu\n3️⃣ Partagez votre numéro à vos clients\n\n_TraiteurPro · Terangaprestige Group 🇸🇳_`;
    await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, wa, msg);

    res.json({ ok: true, id: t.id, traiteur: t, essai_expire: essaiExpire });
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
// ============================================
// MENU PUBLIC
// ============================================

app.get('/api/menu-public/:traiteur_id', async (req, res) => {
  try {
    const t = await pool.query('SELECT id, nom_boutique, proprietaire, telephone, ville, description FROM traiteurs WHERE id=$1 AND actif=true', [req.params.traiteur_id]);
    if (!t.rows[0]) return res.status(404).json({ error: 'Traiteur introuvable' });
    const menus = await pool.query('SELECT * FROM menus WHERE traiteur_id=$1 ORDER BY categorie, nom', [req.params.traiteur_id]);
    res.json({ traiteur: t.rows[0], menus: menus.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// QR CODE
// ============================================
app.get('/api/qrcode/:traiteur_id', async (req, res) => {
  const id = req.params.traiteur_id;
  const url = `https://traiteurpro-production.up.railway.app/menu/${id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=8B1A1A&margin=20`;
  res.json({ qr_url: qrUrl, menu_url: url });
});

// ============================================
// NOTIFICATIONS PUSH
// ============================================
app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { traiteur_id, subscription } = req.body;
    await pool.query(
      'INSERT INTO push_subscriptions (traiteur_id, subscription) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [traiteur_id, JSON.stringify(subscription)]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/push/test/:traiteur_id', async (req, res) => {
  // Simple test - en production utiliser web-push
  res.json({ ok: true, message: 'Push notifications actives' });
});

app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
// Route admin sécurisée - URL cachée
app.get('/backoffice', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
// Ancienne URL /admin - redirige vers 404 pour cacher
app.get('/admin', (req, res) => res.status(404).send('Not found'));
app.get('/inscription', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inscription.html')));
app.get('/carte', (req, res) => res.sendFile(path.join(__dirname, 'public', 'carte.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));

// API CARTE TRAITEURS
app.get('/api/traiteurs-public', async (req, res) => {
  try {
    const { ville } = req.query;
    let q = `SELECT id, nom_boutique, proprietaire, ville, type_cuisine, logo_emoji, description, zone_livraison, frais_livraison, min_commande, whatsapp, (SELECT COUNT(*) FROM commandes_traiteur WHERE traiteur_id=traiteurs.id) as nb_commandes FROM traiteurs WHERE actif=true`;
    const params = [];
    if (ville) { q += ` AND ville=$1`; params.push(ville); }
    q += ' ORDER BY nom_boutique';
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/villes-traiteurs', async (req, res) => {
  try {
    const r = await pool.query(`SELECT ville, COUNT(*) as nb FROM traiteurs WHERE actif=true GROUP BY ville ORDER BY nb DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ============================================
// FACTURE PDF
// ============================================
app.get('/api/facture/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM commandes_traiteur WHERE id=$1', [req.params.id]);
    const c = r.rows[0];
    if (!c) return res.status(404).send('Commande introuvable');
    const t = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [c.traiteur_id]);
    const traiteur = t.rows[0];
    const items = Array.isArray(c.items) ? c.items : JSON.parse(c.items || '[]');
    const date = new Date(c.created_at).toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'});
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;padding:32px;color:#0d0d0d;max-width:600px;margin:0 auto}.header{border-bottom:3px solid #c0392b;padding-bottom:20px;margin-bottom:24px}.nom{font-size:22px;font-weight:900;color:#c0392b}.sub{font-size:12px;color:#888}.facture-num{font-size:20px;font-weight:900;color:#c0392b}.table{width:100%;border-collapse:collapse;margin-bottom:20px}.table th{background:#c0392b;color:white;padding:10px;text-align:left;font-size:12px}.table td{padding:10px;border-bottom:1px solid #f0f0f0;font-size:13px}.total-row{font-weight:900;font-size:15px;color:#c0392b}.footer{margin-top:32px;padding-top:16px;border-top:1px solid #e0e0e0;font-size:11px;color:#888;text-align:center}@media print{body{padding:16px}}</style></head><body>
    <div class="header"><div style="font-size:32px">🍽️</div><div class="nom">${traiteur?.nom_boutique || 'TraiteurPro'}</div><div class="sub">${traiteur?.ville || 'Dakar'} · TraiteurPro 🇸🇳</div></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:24px"><div><div class="facture-num">FACTURE #${c.reference || c.id}</div><div style="font-size:12px;color:#888;margin-top:4px">Date : ${date}</div><div style="font-size:12px;color:#888">Client : ${c.client_nom || c.client_phone}</div>${c.adresse_livraison ? `<div style="font-size:12px;color:#888">📍 ${c.adresse_livraison}</div>` : ''}</div></div>
    <table class="table"><thead><tr><th>Plat</th><th>Qté</th><th>Prix unit.</th><th>Total</th></tr></thead><tbody>
    ${items.map(i => `<tr><td>${i.emoji||'🍽️'} ${i.nom}</td><td>${i.quantite}</td><td>${Number(i.prix).toLocaleString('fr-FR')} FCFA</td><td>${Number(i.prix * i.quantite).toLocaleString('fr-FR')} FCFA</td></tr>`).join('')}
    <tr class="total-row"><td colspan="3">TOTAL</td><td>${Number(c.total).toLocaleString('fr-FR')} FCFA</td></tr></tbody></table>
    <div class="footer"><p>${traiteur?.nom_boutique} · TraiteurPro 🇸🇳</p><p style="margin-top:4px">Merci de votre confiance ! 🙏</p></div>
    <script>window.onload=()=>window.print()<\/script></body></html>`;
    res.send(html);
  } catch(e) { res.status(500).send('Erreur : ' + e.message); }
});

// ============================================
// RAPPORT HEBDO
// ============================================
async function envoyerRapportHebdo(traiteur_id) {
  try {
    const t = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [traiteur_id]);
    const traiteur = t.rows[0];
    if (!traiteur || !traiteur.actif) return;
    const [commandes, revenus, clients, plats] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM commandes_traiteur WHERE traiteur_id=$1 AND created_at > NOW()-INTERVAL '7 days'`, [traiteur_id]),
      pool.query(`SELECT COALESCE(SUM(total),0) as total FROM commandes_traiteur WHERE traiteur_id=$1 AND created_at > NOW()-INTERVAL '7 days'`, [traiteur_id]),
      pool.query(`SELECT COUNT(DISTINCT client_phone) FROM commandes_traiteur WHERE traiteur_id=$1 AND created_at > NOW()-INTERVAL '7 days'`, [traiteur_id]),
      pool.query(`SELECT item->>'nom' as nom, item->>'emoji' as emoji, SUM((item->>'quantite')::int) as total FROM commandes_traiteur, jsonb_array_elements(items) as item WHERE traiteur_id=$1 AND created_at > NOW()-INTERVAL '7 days' GROUP BY nom, emoji ORDER BY total DESC LIMIT 3`, [traiteur_id])
    ]);
    const nbCmd = parseInt(commandes.rows[0].count);
    const rev = parseInt(revenus.rows[0].total);
    const nbClients = parseInt(clients.rows[0].count);
    const platStar = plats.rows[0];
    const msg = `📊 *Rapport hebdomadaire*\n_${traiteur.nom_boutique}_\n\n📋 Commandes : *${nbCmd}*\n💰 Revenus : *${rev.toLocaleString('fr-FR')} FCFA*\n👥 Clients actifs : *${nbClients}*\n${platStar ? `🔥 Plat star : *${platStar.emoji||'🍽️'} ${platStar.nom}* (${platStar.total} cmd)\n` : ''}\n_Bonne semaine ! 💪_\n_TraiteurPro 🇸🇳_`;
    await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, traiteur.whatsapp, msg);
    console.log(`📊 Rapport hebdo envoyé → ${traiteur.nom_boutique}`);
  } catch(e) { console.error('Rapport hebdo error:', e.message); }
}

async function planifierRapportHebdo() {
  const now = new Date();
  const jour = now.getDay();
  const daysUntilMonday = jour === 1 && now.getHours() < 9 ? 0 : (8 - jour) % 7 || 7;
  const prochainLundi = new Date(now);
  prochainLundi.setDate(now.getDate() + daysUntilMonday);
  prochainLundi.setHours(9, 0, 0, 0);
  const delai = prochainLundi - now;
  console.log(`📊 Prochain rapport hebdo dans ${Math.round(delai/3600000)}h`);
  setTimeout(async () => {
    const ts = await pool.query('SELECT id FROM traiteurs WHERE actif=true');
    for (const t of ts.rows) await envoyerRapportHebdo(t.id);
    setInterval(async () => {
      const ts2 = await pool.query('SELECT id FROM traiteurs WHERE actif=true');
      for (const t of ts2.rows) await envoyerRapportHebdo(t.id);
    }, 7*24*60*60*1000);
  }, delai);
}

app.get('/api/rapport-hebdo/:traiteur_id', adminMiddleware, async (req, res) => {
  try {
    await envoyerRapportHebdo(parseInt(req.params.traiteur_id));
    res.json({ ok: true, message: 'Rapport envoyé !' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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
// MIGRATION DB
// ============================================
app.get('/api/admin/migrate', async (req, res) => {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Non autorisé' });
  try {
    await pool.query(`
      ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS essai_expire TIMESTAMP;
      ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS parrain_id INTEGER;
      ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS abonnement_expire TIMESTAMP;
      ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS seuil_commandes INTEGER DEFAULT 30;
    `);
    // Activer essai 14j pour traiteurs existants sans essai_expire
    await pool.query(`
      UPDATE traiteurs SET essai_expire = NOW() + INTERVAL '14 days'
      WHERE essai_expire IS NULL AND plan != 'pro'
    `);
    res.json({ ok: true, message: '✅ Migration réussie ! Colonnes ajoutées et essais activés.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// ESSAI + SUSPENSION DOUCE + PARRAINAGE
// ============================================

// Vérifier statut essai du traiteur
app.get('/api/essai/:traiteur_id', async (req, res) => {
  try {
    const t = await pool.query('SELECT id, nom_boutique, plan, essai_expire, abonnement_expire, actif FROM traiteurs WHERE id=$1', [req.params.traiteur_id]);
    if (!t.rows[0]) return res.status(404).json({ error: 'Traiteur introuvable' });
    const tr = t.rows[0];
    const now = new Date();
    const essaiActif = tr.essai_expire && new Date(tr.essai_expire) > now;
    const abonnementActif = tr.abonnement_expire && new Date(tr.abonnement_expire) > now;

    // Jours restants essai
    const joursEssai = tr.essai_expire
      ? Math.max(0, Math.ceil((new Date(tr.essai_expire) - now) / (1000*60*60*24)))
      : 0;

    // Suspension douce : essai expiré + pas d'abonnement
    const suspenduDoux = !essaiActif && !abonnementActif && tr.plan === 'starter';

    res.json({
      plan: tr.plan,
      essai_actif: essaiActif,
      essai_expire: tr.essai_expire ? new Date(tr.essai_expire).toLocaleDateString('fr-FR') : null,
      jours_essai: joursEssai,
      abonnement_actif: abonnementActif,
      suspendu_doux: suspenduDoux,
      actif: tr.actif
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Alerte essai J-3
async function alertesEssai() {
  try {
    // Essais expirant dans 3 jours
    const r = await pool.query(`
      SELECT * FROM traiteurs
      WHERE essai_expire BETWEEN NOW() + INTERVAL '2 days' AND NOW() + INTERVAL '3 days'
      AND actif=true
    `);
    for (const t of r.rows) {
      const msg = `⏰ *Votre essai TraiteurPro expire bientôt !*\n\nBonjour ${t.proprietaire||t.nom_boutique} !\n\nVotre essai gratuit *Starter* expire dans *3 jours*.\n\n💳 *Continuez pour seulement 15 000 FCFA/mois* et gardez :\n✅ Commandes illimitées\n✅ Bot WhatsApp IA\n✅ Promotions flash\n\n👉 Abonnez-vous maintenant :\nhttps://traiteurpro-production.up.railway.app/app?id=${t.id}\n\n_TraiteurPro 🇸🇳_`;
      await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, t.whatsapp, msg);
      console.log(`⏰ Alerte essai J-3 → ${t.nom_boutique}`);
    }

    // Essais expirés aujourd'hui → suspension douce
    const expir = await pool.query(`
      SELECT * FROM traiteurs
      WHERE essai_expire BETWEEN NOW() - INTERVAL '1 hour' AND NOW()
      AND abonnement_expire IS NULL AND actif=true
    `);
    for (const t of expir.rows) {
      const msg = `🔴 *Votre essai TraiteurPro est terminé*\n\nBonjour ${t.proprietaire||t.nom_boutique} !\n\nVotre essai de 14 jours est terminé. Votre bot est en *pause*.\n\n💳 *Réactivez pour 15 000 FCFA/mois* :\nhttps://traiteurpro-production.up.railway.app/app?id=${t.id}\n\n_Vos données sont conservées 30 jours._\n_TraiteurPro 🇸🇳_`;
      await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, t.whatsapp, msg);
      console.log(`🔴 Suspension douce → ${t.nom_boutique}`);
    }
  } catch(e) { console.error('Alertes essai:', e.message); }
}
setInterval(alertesEssai, 6*60*60*1000); // toutes les 6h

// Parrainage — récupérer son code + stats
app.get('/api/parrainage/:traiteur_id', async (req, res) => {
  try {
    const t = await pool.query('SELECT id, nom_boutique, referral_code FROM traiteurs WHERE id=$1', [req.params.traiteur_id]);
    if (!t.rows[0]) return res.status(404).json({ error: 'Traiteur introuvable' });
    const filleuls = await pool.query('SELECT COUNT(*) FROM traiteurs WHERE parrain_id=$1', [req.params.traiteur_id]);
    const nb = parseInt(filleuls.rows[0].count);
    res.json({
      code: t.rows[0].referral_code,
      lien: `https://traiteurpro-production.up.railway.app?ref=${t.rows[0].referral_code}`,
      filleuls: nb,
      mois_gagnes: nb
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// PWA — manifest + service worker
// ============================================
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'TraiteurPro',
    short_name: 'TraiteurPro',
    description: 'Le SaaS des Traiteurs Sénégalais',
    start_url: '/app',
    display: 'standalone',
    background_color: '#080808',
    theme_color: '#c0392b',
    orientation: 'portrait',
    lang: 'fr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ],
    shortcuts: [
      { name: 'Dashboard', url: '/app' },
      { name: 'Commandes', url: '/app' }
    ]
  });
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(`
const CACHE='traiteurpro-v1';
const ASSETS=['/','/app','/manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.url.includes('/api/'))return e.respondWith(fetch(e.request));e.respondWith(fetch(e.request).then(res=>{const clone=res.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));return res}).catch(()=>caches.match(e.request)))});
self.addEventListener('push',e=>{const data=e.data?.json()||{};self.registration.showNotification(data.title||'🍽️ TraiteurPro',{body:data.body||'Nouvelle notification',icon:'/icons/icon-192.png',vibrate:[200,100,200],data:{url:data.url||'/app'}})});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.openWindow(e.notification.data?.url||'/app'))});
  `);
});

// ============================================
// DÉMARRAGE
// ============================================
initDB().then(() => {
  app.listen(process.env.PORT || 3001, () => {
    console.log('🍽️ TraiteurPro v1.0 démarré sur port ' + (process.env.PORT || 3001));
    planifierRelances();
    planifierRapportHebdo();
  });
}).catch(err => console.error('Erreur démarrage:', err));
// Reset données démo
app.get('/api/admin/reset-demo', async (req, res) => {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Non autorisé' });
  try {
    await pool.query('DELETE FROM commandes_traiteur WHERE traiteur_id=1');
    await pool.query('DELETE FROM clients_traiteur WHERE traiteur_id=1');
    await pool.query('DELETE FROM menus WHERE traiteur_id=1');
    await pool.query('DELETE FROM traiteurs WHERE id=1');
    res.json({ ok: true, message: '✅ Données démo supprimées ! TraiteurPro est propre.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// ABONNEMENTS
// ============================================

// Table abonnements
async function initAbonnements() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS abonnements (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      plan VARCHAR(20) NOT NULL,
      montant INTEGER NOT NULL,
      statut VARCHAR(20) DEFAULT 'en_attente',
      reference VARCHAR(50),
      date_debut TIMESTAMP,
      date_fin TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS abonnement_expire TIMESTAMP;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS seuil_commandes INTEGER DEFAULT 30;
  `);
}
initAbonnements().catch(e => console.log('Abonnements init:', e.message));

const PLANS = {
  gratuit: { montant: 0, commandes: 30, label: 'Gratuit' },
  starter: { montant: 15000, commandes: 500, label: 'Starter' },
  pro: { montant: 35000, commandes: 999999, label: 'Pro' }
};

// Initier paiement abonnement
app.post('/api/abonnement/payer', async (req, res) => {
  try {
    const { traiteur_id, plan } = req.body;
    const t = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [traiteur_id]);
    const traiteur = t.rows[0];
    if (!traiteur) return res.status(404).json({ error: 'Traiteur introuvable' });
    const planInfo = PLANS[plan];
    if (!planInfo) return res.status(400).json({ error: 'Plan invalide' });
    if (planInfo.montant === 0) {
      await pool.query('UPDATE traiteurs SET plan=$1, seuil_commandes=$2 WHERE id=$3', ['gratuit', 30, traiteur_id]);
      return res.json({ ok: true, gratuit: true, message: 'Plan gratuit activé' });
    }
    // PayDunya
    const ref = `TP-${traiteur_id}-${Date.now()}`;
    const payload = {
      invoice: {
        total_amount: planInfo.montant,
        description: `TraiteurPro ${planInfo.label} — ${traiteur.nom_boutique}`
      },
      store: { name: 'TraiteurPro' },
      actions: {
        cancel_url: `https://traiteurpro-production.up.railway.app/app?id=${traiteur_id}`,
        return_url: `https://traiteurpro-production.up.railway.app/api/abonnement/confirm?ref=${ref}&traiteur_id=${traiteur_id}&plan=${plan}`,
        callback_url: `https://traiteurpro-production.up.railway.app/api/abonnement/callback`
      },
      custom_data: { ref, traiteur_id, plan }
    };
    const r = await fetch('https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYDUNYA-MASTER-KEY': process.env.PAYDUNYA_PRIVATE_KEY,
        'PAYDUNYA-PUBLIC-KEY': process.env.PAYDUNYA_PUBLIC_KEY,
        'PAYDUNYA-TOKEN': process.env.PAYDUNYA_TOKEN
      },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (d.response_code === '00') {
      await pool.query('INSERT INTO abonnements (traiteur_id, plan, montant, reference) VALUES ($1,$2,$3,$4)', [traiteur_id, plan, planInfo.montant, ref]);
      res.json({ ok: true, url: d.response_text });
    } else {
      res.status(500).json({ error: 'Erreur PayDunya', detail: d });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Confirmation paiement
app.get('/api/abonnement/confirm', async (req, res) => {
  try {
    const { ref, traiteur_id, plan } = req.query;
    const planInfo = PLANS[plan];
    const now = new Date();
    const fin = new Date(now);
    fin.setMonth(fin.getMonth() + 1);
    await pool.query(
      'UPDATE traiteurs SET plan=$1, seuil_commandes=$2, abonnement_expire=$3, actif=true WHERE id=$4',
      [plan, planInfo.commandes, fin, traiteur_id]
    );
    await pool.query(
      'UPDATE abonnements SET statut=$1, date_debut=$2, date_fin=$3 WHERE reference=$4',
      ['payé', now, fin, ref]
    );
    const t = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [traiteur_id]);
    const traiteur = t.rows[0];
    const msg = `✅ *Paiement reçu !*\n\n🎉 Votre abonnement *TraiteurPro ${planInfo.label}* est activé !\n\n📅 Valide jusqu'au : ${fin.toLocaleDateString('fr-FR')}\n📋 Commandes autorisées : ${planInfo.commandes === 999999 ? 'Illimitées' : planInfo.commandes}\n\n🔗 Votre dashboard : https://traiteurpro-production.up.railway.app/app?id=${traiteur_id}\n\n_Merci de votre confiance ! 🙏_\n_TraiteurPro 🇸🇳_`;
    await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, traiteur.whatsapp, msg);
    res.redirect(`https://traiteurpro-production.up.railway.app/app?id=${traiteur_id}&success=1`);
  } catch(e) { res.status(500).send('Erreur confirmation: ' + e.message); }
});

// Callback PayDunya (webhook)
app.post('/api/abonnement/callback', async (req, res) => {
  try {
    const data = req.body;
    const ref = data?.custom_data?.ref;
    const traiteur_id = data?.custom_data?.traiteur_id;
    const plan = data?.custom_data?.plan;
    if (ref && traiteur_id && plan) {
      const planInfo = PLANS[plan];
      const now = new Date();
      const fin = new Date(now);
      fin.setMonth(fin.getMonth() + 1);
      await pool.query('UPDATE traiteurs SET plan=$1, seuil_commandes=$2, abonnement_expire=$3 WHERE id=$4', [plan, planInfo.commandes, fin, traiteur_id]);
      await pool.query('UPDATE abonnements SET statut=$1 WHERE reference=$2', ['payé', ref]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Statut abonnement
app.get('/api/abonnement/:traiteur_id', async (req, res) => {
  try {
    const t = await pool.query('SELECT id, nom_boutique, plan, seuil_commandes, abonnement_expire FROM traiteurs WHERE id=$1', [req.params.traiteur_id]);
    const traiteur = t.rows[0];
    if (!traiteur) return res.status(404).json({ error: 'Traiteur introuvable' });
    const nbCmd = await pool.query('SELECT COUNT(*) FROM commandes_traiteur WHERE traiteur_id=$1 AND created_at > date_trunc(\'month\', NOW())', [req.params.traiteur_id]);
    const utilise = parseInt(nbCmd.rows[0].count);
    const expire = traiteur.abonnement_expire ? new Date(traiteur.abonnement_expire) : null;
    const actif = !expire || expire > new Date();
    res.json({
      plan: traiteur.plan,
      seuil: traiteur.seuil_commandes,
      utilise,
      reste: Math.max(0, (traiteur.seuil_commandes || 30) - utilise),
      expire: expire?.toLocaleDateString('fr-FR'),
      actif
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Relance abonnements expirant dans 3 jours
async function relancerAbonnements() {
  try {
    const r = await pool.query(`SELECT * FROM traiteurs WHERE abonnement_expire BETWEEN NOW() AND NOW() + INTERVAL '3 days' AND actif=true`);
    for (const t of r.rows) {
      const msg = `⚠️ *Abonnement TraiteurPro*\n\nBonjour ${t.proprietaire} !\n\nVotre abonnement *${t.plan}* expire dans *3 jours*.\n\n💳 Renouvelez maintenant :\nhttps://traiteurpro-production.up.railway.app/app?id=${t.id}&onglet=abonnement\n\n_TraiteurPro 🇸🇳_`;
      await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, t.whatsapp, msg);
      console.log(`⚠️ Relance abonnement → ${t.nom_boutique}`);
    }
  } catch(e) { console.error('Relance abonnements:', e.message); }
}
setInterval(relancerAbonnements, 24*60*60*1000);
