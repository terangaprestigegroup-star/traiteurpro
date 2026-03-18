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
      facebook TEXT,
      instagram TEXT,
      tiktok TEXT,
      youtube TEXT,
      site_web TEXT,
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
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS facebook TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS instagram TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS tiktok TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS youtube TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS site_web TEXT;
    CREATE TABLE IF NOT EXISTS avis (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      client_nom VARCHAR(100),
      client_phone VARCHAR(20),
      note INTEGER CHECK(note BETWEEN 1 AND 5),
      commentaire TEXT,
      commande_ref VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS echelonnes (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      nom VARCHAR(200) NOT NULL,
      description TEXT,
      client_phone VARCHAR(20),
      total DECIMAL(12,2) NOT NULL,
      acompte DECIMAL(12,2) DEFAULT 0,
      date_solde DATE,
      statut VARCHAR(20) DEFAULT 'en_cours',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS evenements (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      titre VARCHAR(200) NOT NULL,
      type VARCHAR(50) DEFAULT 'commande',
      date_event DATE NOT NULL,
      heure_event TIME,
      lieu TEXT,
      client_nom VARCHAR(100),
      client_phone VARCHAR(20),
      nb_personnes INTEGER DEFAULT 1,
      montant DECIMAL(12,2) DEFAULT 0,
      acompte DECIMAL(12,2) DEFAULT 0,
      notes TEXT,
      statut VARCHAR(30) DEFAULT 'planifie',
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS adresse TEXT;
    CREATE TABLE IF NOT EXISTS livreurs (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      telephone TEXT NOT NULL,
      transport TEXT DEFAULT 'Moto',
      zone TEXT,
      disponible BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS traiteur_id INTEGER;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS telephone TEXT;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS transport TEXT DEFAULT 'Moto';
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS zone TEXT;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS disponible BOOLEAN DEFAULT true;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS pin VARCHAR(10) DEFAULT '1234';
    UPDATE livreurs SET traiteur_id = merchant_id WHERE traiteur_id IS NULL AND merchant_id IS NOT NULL;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS position_at TIMESTAMP;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS photo_preuve TEXT;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS code_confirmation VARCHAR(10);
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS code_confirmation VARCHAR(10);
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS duree_minutes INTEGER;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS note_client INTEGER;
    CREATE TABLE IF NOT EXISTS messages_livreur (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      livreur_id INTEGER NOT NULL,
      livraison_id INTEGER,
      expediteur VARCHAR(20) NOT NULL,
      contenu TEXT NOT NULL,
      lu BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS traiteur_id INTEGER;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS montant INTEGER DEFAULT 0;
    -- Renommer merchant_id en traiteur_id dans livreurs si nécessaire
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='livreurs' AND column_name='merchant_id') 
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='livreurs' AND column_name='traiteur_id') THEN
        ALTER TABLE livreurs RENAME COLUMN merchant_id TO traiteur_id;
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS livraisons (
      id SERIAL PRIMARY KEY,
      livreur_id INTEGER,
      commande_id INTEGER,
      traiteur_id INTEGER,
      statut TEXT DEFAULT 'assignée',
      adresse TEXT,
      montant INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      livree_at TIMESTAMP
    );
    ALTER TABLE commandes_traiteur ADD COLUMN IF NOT EXISTS livreur_id INTEGER DEFAULT NULL;
  `);

  // Traiteur démo
  await pool.query(`
    INSERT INTO traiteurs (id, nom_boutique, proprietaire, whatsapp, ville, type_cuisine, plan, referral_code, logo_emoji, description, zone_livraison, actif)
    VALUES (1, 'Chez Fatou Traiteur', 'Fatou Diallo', '221771234567', 'Dakar', 'sénégalaise', 'pro', 'FATOUTP1', '🍲', 'Spécialiste thiéboudienne, yassa et mafé depuis 15 ans', 'Dakar, Plateau, Médina', true)
    ON CONFLICT (id) DO UPDATE SET actif=true;
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

  // Activer TOUS les traiteurs — permanent
  await pool.query('UPDATE traiteurs SET actif=true WHERE actif IS NULL OR actif=false');
  // Table livreurs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS livreurs (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      telephone TEXT NOT NULL,
      transport TEXT DEFAULT 'Moto',
      zone TEXT,
      disponible BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Table assignations livreurs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS livraisons (
      id SERIAL PRIMARY KEY,
      livreur_id INTEGER REFERENCES livreurs(id) ON DELETE SET NULL,
      commande_id INTEGER,
      traiteur_id INTEGER,
      statut TEXT DEFAULT 'assignée',
      adresse TEXT,
      montant INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      livree_at TIMESTAMP
    )
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
          Menus disponibles: ${JSON.stringify(menus.map(m => ({ nom: m.nom.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}]\s*/u,'').trim(), prix: m.prix, emoji: m.emoji, nb_personnes: m.nb_personnes })))}
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

    // Identifier le traiteur par le numéro WhatsApp du bot (phone_number_id → traiteur)
    let traiteur_id = clientTraiteurMap[phone];
    if (!traiteur_id) {
      // Chercher le traiteur dont le whatsapp correspond au numéro entrant
      const cmdClient = await pool.query(
        'SELECT traiteur_id FROM commandes_traiteur WHERE client_phone=$1 ORDER BY created_at DESC LIMIT 1',
        [phone]
      );
      if (cmdClient.rows[0]) {
        traiteur_id = cmdClient.rows[0].traiteur_id;
      } else {
        // Fallback: premier traiteur actif avec WhatsApp configuré
        const r = await pool.query('SELECT id FROM traiteurs WHERE actif=true AND whatsapp IS NOT NULL ORDER BY id LIMIT 1');
        if (r.rows[0]) traiteur_id = r.rows[0].id;
      }
      if (traiteur_id) clientTraiteurMap[phone] = traiteur_id;
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
    // ---- BONJOUR / BIENVENUE
    if (/^(bonjour|bonsoir|salut|salam|hello|hi|bjr|bsr)$/i.test(texte.trim())) {
      await envoyerWhatsApp(phone_id, phone,
        `👋 *Bonjour !*\n\nBienvenue chez *${traiteur.nom_boutique}* 🍽️\n\n` +
        `Que puis-je faire pour vous ?\n\n` +
        `📋 *menu* — Voir nos plats\n` +
        `📦 *commande* — Passer une commande\n` +
        `📍 *livraison* — Infos livraison\n` +
        `📞 *contact* — Nous contacter\n\n` +
        `_Répondez avec un mot-clé ou commandez directement !_`
      );
      return res.sendStatus(200);
    }

    // ---- INFOS LIVRAISON
    if (/livraison|délai|zone|quartier|frais|gratuit/i.test(texte)) {
      await envoyerWhatsApp(phone_id, phone,
        `🚚 *Informations livraison*\n\n` +
        `📍 Zones : ${traiteur.zone_livraison || 'Dakar et environs'}\n` +
        `⏱️ Délai : 30 à 60 minutes\n` +
        `💰 Frais : Inclus dans le prix\n\n` +
        `_Pour commander, envoyez votre plat directement !_\n\n` +
        `_${traiteur.nom_boutique} · TraiteurPro 🇸🇳_`
      );
      return res.sendStatus(200);
    }

    // ---- CONTACT
    if (/contact|numéro|appel|téléphone|joindre/i.test(texte)) {
      await envoyerWhatsApp(phone_id, phone,
        `📞 *Contactez-nous*\n\n` +
        `📱 WhatsApp : ${traiteur.whatsapp || 'Ce numéro'}\n` +
        `📍 Ville : ${traiteur.ville || 'Dakar'}\n\n` +
        `_${traiteur.nom_boutique} · TraiteurPro 🇸🇳_`
      );
      return res.sendStatus(200);
    }

    // ---- AIDE
    if (/aide|help|comment|que faire|quoi faire/i.test(texte)) {
      await envoyerWhatsApp(phone_id, phone,
        `ℹ️ *Comment commander ?*\n\n` +
        `1️⃣ Envoyez *"menu"* pour voir les plats\n` +
        `2️⃣ Dites ce que vous voulez : _"Je veux 2 thiéboudiennes"_\n` +
        `3️⃣ Donnez votre adresse\n` +
        `4️⃣ Choisissez la date de livraison\n` +
        `5️⃣ Commande confirmée ! ✅\n\n` +
        `_${traiteur.nom_boutique} · TraiteurPro 🇸🇳_`
      );
      return res.sendStatus(200);
    }

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

    // ---- AVIS CLIENT (réponse ⭐ 1-5 après livraison)
    if (/^[1-5]$/.test(texte.trim()) || /^[⭐]{1,5}$/.test(texte.trim())) {
      const note = parseInt(texte.trim()) || texte.trim().length;
      const lastCmd = await pool.query(
        'SELECT * FROM commandes_traiteur WHERE client_phone=$1 AND traiteur_id=$2 AND statut=$3 ORDER BY created_at DESC LIMIT 1',
        [phone, traiteur_id, 'livré']
      );
      const ref = lastCmd.rows[0]?.reference || null;
      // Récupérer nom client si dispo
      const nomClient = lastCmd.rows[0]?.client_nom || phone;
      await pool.query(
        'INSERT INTO avis (traiteur_id, client_nom, client_phone, note, commande_ref) VALUES ($1,$2,$3,$4,$5)',
        [traiteur_id, nomClient, phone, Math.min(5, Math.max(1, note)), ref]
      );
      const remercie = note >= 4
        ? `Merci pour votre ${note}⭐ ! Votre satisfaction est notre priorité 🙏`
        : `Merci pour votre retour. Nous allons nous améliorer 🙏`;
      await envoyerWhatsApp(phone_id, phone,
        `${remercie}

_${traiteur.nom_boutique} · TraiteurPro 🇸🇳_`
      );
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
    const { traiteur_id, nom, description, prix, categorie, emoji, nb_personnes, image_url } = req.body;
    const r = await pool.query(
      'INSERT INTO menus (traiteur_id, nom, description, prix, categorie, emoji, nb_personnes, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [traiteur_id, nom, description, prix, categorie||'plat', emoji||'🍽️', nb_personnes||1, image_url||null]
    );
    res.json({ ok: true, menu: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/menus/:id', async (req, res) => {
  try {
    const { nom, description, prix, categorie, emoji, disponible, image_url } = req.body;
    const r = await pool.query(
      'UPDATE menus SET nom=COALESCE($1,nom), description=COALESCE($2,description), prix=COALESCE($3,prix), categorie=COALESCE($4,categorie), emoji=COALESCE($5,emoji), disponible=COALESCE($6,disponible), image_url=COALESCE($7,image_url) WHERE id=$8 RETURNING *',
      [nom, description, prix, categorie, emoji, disponible, image_url||null, req.params.id]
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
    // Si statut livré → sync livraison + remettre livreur disponible
    if (statut === 'livré') {
      const livRes = await pool.query("UPDATE livraisons SET statut='livrée', livree_at=NOW() WHERE commande_id=$1 RETURNING livreur_id", [cmd.id]);
      if (livRes.rows[0]?.livreur_id) {
        await pool.query('UPDATE livreurs SET disponible=true WHERE id=$1', [livRes.rows[0].livreur_id]);
      }
    }
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
// ============================================
// LIVREURS — CRUD + HISTORIQUE + STATS
// ============================================

// GET tous les livreurs d'un traiteur
app.get('/api/livreurs/:traiteur_id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.*, 
        COUNT(lv.id) as nb_livraisons,
        SUM(CASE WHEN lv.statut='livrée' THEN 1 ELSE 0 END) as nb_livrees
       FROM livreurs l
       LEFT JOIN livraisons lv ON lv.livreur_id = l.id
       WHERE (l.traiteur_id=$1 OR l.merchant_id=$1)
       GROUP BY l.id ORDER BY l.nom`,
      [req.params.traiteur_id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST créer livreur
app.post('/api/livreurs', async (req, res) => {
  try {
    const { traiteur_id, nom, telephone, transport, zone } = req.body;
    if (!nom || !telephone) return res.status(400).json({ error: 'Nom et téléphone requis' });
    // Essayer traiteur_id, sinon merchant_id (ancienne colonne)
    let insertResult;
    try {
      insertResult = await pool.query(
        'INSERT INTO livreurs (traiteur_id, nom, telephone, transport, zone) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [traiteur_id, nom, telephone.replace(/[^0-9]/g,''), transport||'Moto', zone||'']
      );
    } catch(e1) {
      // Fallback: utiliser merchant_id si traiteur_id n'existe pas
      insertResult = await pool.query(
        'INSERT INTO livreurs (merchant_id, nom, telephone, transport, zone) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [traiteur_id, nom, telephone.replace(/[^0-9]/g,''), transport||'Moto', zone||'']
      );
    }
    const r = insertResult;
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT disponibilité livreur
app.put('/api/livreurs/:id/dispo', async (req, res) => {
  try {
    const { disponible } = req.body;
    const r = await pool.query('UPDATE livreurs SET disponible=$1 WHERE id=$2 RETURNING *', [disponible, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE livreur
app.delete('/api/livreurs/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM livreurs WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST assigner livreur à une commande + notif WhatsApp
app.post('/api/livreurs/:id/assigner', async (req, res) => {
  try {
    const { commande_id, traiteur_id, adresse, montant } = req.body;
    const livr = await pool.query('SELECT * FROM livreurs WHERE id=$1', [req.params.id]);
    if (!livr.rows[0]) return res.status(404).json({ error: 'Livreur introuvable' });
    const l = livr.rows[0];

    // Enregistrer livraison
    await pool.query(
      'INSERT INTO livraisons (livreur_id, commande_id, traiteur_id, adresse, montant) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, commande_id||null, traiteur_id, adresse||'', montant||0]
    );

    // Marquer livreur occupé
    await pool.query('UPDATE livreurs SET disponible=false WHERE id=$1', [req.params.id]);

    // Générer code confirmation 4 chiffres
    const codeConf = Math.floor(1000 + Math.random() * 9000).toString();
    await pool.query('UPDATE livraisons SET code_confirmation=$1 WHERE livreur_id=$2 AND commande_id=$3',
      [codeConf, req.params.id, commande_id||null]);
    // Envoyer code au client
    if (commande_id) {
      const cmdRes = await pool.query('SELECT * FROM commandes_traiteur WHERE id=$1', [commande_id]);
      const cmd = cmdRes.rows[0];
      if (cmd?.client_phone) {
        await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, cmd.client_phone,
          `🔐 *Code de confirmation livraison*

Réf : *${cmd.reference}*

Votre code : *${codeConf}*

Donnez ce code à votre livreur à la réception de votre commande ✅

_TraiteurPro 🇸🇳_`);
      }
    }

    // Générer code confirmation client (4 chiffres)
    const codeConfirm = Math.floor(1000 + Math.random() * 9000).toString();
    await pool.query('UPDATE livraisons SET code_confirmation=$1 WHERE livreur_id=$2 AND commande_id=$3',
      [codeConfirm, req.params.id, commande_id||null]);
    // Envoyer code au client
    if (commande_id) {
      const cmdRes = await pool.query('SELECT * FROM commandes_traiteur WHERE id=$1', [commande_id]);
      const cmd = cmdRes.rows[0];
      if (cmd?.client_phone) {
        await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, cmd.client_phone,
          `🔐 *Code de confirmation livraison*

Votre code : *${codeConfirm}*

Donnez ce code à votre livreur à la réception de votre commande.

_TraiteurPro 🍽️_`);
      }
    }
    // Notif WhatsApp au livreur
    const traiteur = await pool.query('SELECT nom_boutique FROM traiteurs WHERE id=$1', [traiteur_id]);
    const nomTrateur = traiteur.rows[0]?.nom_boutique || 'TraiteurPro';
    const msg = `🚚 *Nouvelle livraison assignée !*

🏪 Traiteur : *${nomTrateur}*
📍 Adresse : ${adresse||'À confirmer'}
💰 Montant : ${Number(montant||0).toLocaleString('fr-FR')} FCFA

_Connectez-vous pour confirmer la livraison._

_TraiteurPro 🍽️_`;

    const phone = l.telephone.replace(/\D/g,'');
    const telFull = phone.startsWith('221') ? phone : '221'+phone;
    await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, telFull, msg);

    res.json({ ok: true, message: 'Livreur assigné et notifié' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET historique + stats d'un livreur
app.get('/api/livreurs/:id/historique', async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN statut='livrée' THEN 1 ELSE 0 END) as livrees,
        SUM(CASE WHEN statut='assignée' THEN 1 ELSE 0 END) as en_cours,
        COALESCE(SUM(montant),0) as total_montant
       FROM livraisons WHERE livreur_id=$1`,
      [req.params.id]
    );
    const historique = await pool.query(
      `SELECT * FROM livraisons WHERE livreur_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ stats: stats.rows[0], historique: historique.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT marquer livraison terminée

// ============================================
// PROFIL TRAITEUR — Mise à jour réseaux sociaux
// ============================================
app.put('/api/traiteur/profil/:id', async (req, res) => {
  try {
    const { nom_boutique, description, zone_livraison, facebook, instagram, tiktok, youtube, site_web } = req.body;
    await pool.query(
      `UPDATE traiteurs SET
        nom_boutique=COALESCE($1,nom_boutique),
        description=COALESCE($2,description),
        zone_livraison=COALESCE($3,zone_livraison),
        facebook=COALESCE($4,facebook),
        instagram=COALESCE($5,instagram),
        tiktok=COALESCE($6,tiktok),
        youtube=COALESCE($7,youtube),
        site_web=COALESCE($8,site_web)
      WHERE id=$9`,
      [nom_boutique||null, description||null, zone_livraison||null,
       facebook||null, instagram||null, tiktok||null, youtube||null, site_web||null,
       req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET profil traiteur
app.get('/api/traiteur/profil/:id', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, nom_boutique, proprietaire, whatsapp, ville, type_cuisine, description, zone_livraison, logo_emoji, plan, essai_expire, abonnement_expire, facebook, instagram, tiktok, youtube, site_web FROM traiteurs WHERE id=$1',
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Traiteur introuvable' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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
      `INSERT INTO traiteurs (nom_boutique, proprietaire, whatsapp, ville, type_cuisine, plan, referral_code, description, zone_livraison, essai_expire, parrain_id, actif)
       VALUES ($1,$2,$3,$4,$5,'starter',$6,$7,$8,$9,$10,true) RETURNING *`,
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
    const [traiteurs, commandes, clients, actifs, plans, livreurs, avis, evenements, messages, revenus_mois] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM traiteurs'),
      pool.query('SELECT COUNT(*) FROM commandes_traiteur'),
      pool.query('SELECT COUNT(DISTINCT client_phone) FROM commandes_traiteur'),
      pool.query('SELECT COUNT(*) FROM traiteurs WHERE actif=true'),
      pool.query('SELECT plan, COUNT(*) as nb FROM traiteurs GROUP BY plan'),
      pool.query('SELECT COUNT(*) FROM livreurs'),
      pool.query('SELECT COUNT(*) FROM avis'),
      pool.query('SELECT COUNT(*) FROM evenements'),
      pool.query('SELECT COUNT(*) FROM messages_livreur'),
      pool.query("SELECT COALESCE(SUM(total),0) as total FROM commandes_traiteur WHERE created_at > NOW() - INTERVAL '30 days' AND statut='livré'"),
    ]);
    const plansMap = {};
    plans.rows.forEach(p => { plansMap[p.plan] = parseInt(p.nb); });
    res.json({
      traiteurs: parseInt(traiteurs.rows[0].count),
      commandes: parseInt(commandes.rows[0].count),
      clients: parseInt(clients.rows[0].count),
      actifs: parseInt(actifs.rows[0].count),
      livreurs: parseInt(livreurs.rows[0].count),
      avis: parseInt(avis.rows[0].count),
      evenements: parseInt(evenements.rows[0].count),
      messages: parseInt(messages.rows[0].count),
      revenus_mois: parseInt(revenus_mois.rows[0].total),
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
    const t = await pool.query('SELECT id, nom_boutique, proprietaire, whatsapp as telephone, ville, description, facebook, instagram, tiktok, youtube, site_web FROM traiteurs WHERE id=$1 AND actif=true', [req.params.traiteur_id]);
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
// ============================================
// AVIS CLIENTS
// ============================================
app.get('/api/avis/:traiteur_id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM avis WHERE traiteur_id=$1 ORDER BY created_at DESC', [req.params.traiteur_id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/avis', async (req, res) => {
  try {
    const { traiteur_id, client_nom, client_phone, note, commentaire, commande_ref } = req.body;
    const r = await pool.query(
      'INSERT INTO avis (traiteur_id, client_nom, client_phone, note, commentaire, commande_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [traiteur_id, client_nom||null, client_phone||null, note||5, commentaire||null, commande_ref||null]
    );
    res.json({ ok: true, avis: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/avis/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM avis WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// ECHELONNES
// ============================================
app.get('/api/echelonnes/:traiteur_id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM echelonnes WHERE traiteur_id=$1 ORDER BY created_at DESC', [req.params.traiteur_id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/echelonnes', async (req, res) => {
  try {
    const { traiteur_id, nom, description, client_phone, total, acompte, date_solde } = req.body;
    const r = await pool.query(
      'INSERT INTO echelonnes (traiteur_id, nom, description, client_phone, total, acompte, date_solde) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [traiteur_id, nom, description||null, client_phone||null, total, acompte||0, date_solde||null]
    );
    res.json({ ok: true, echelonne: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/echelonnes/:id', async (req, res) => {
  try {
    const { acompte, statut } = req.body;
    const r = await pool.query(
      'UPDATE echelonnes SET acompte=COALESCE($1,acompte), statut=COALESCE($2,statut) WHERE id=$3 RETURNING *',
      [acompte, statut, req.params.id]
    );
    res.json({ ok: true, echelonne: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/echelonnes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM echelonnes WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// AGENDA / EVENEMENTS
// ============================================
app.get('/api/evenements/:traiteur_id', async (req, res) => {
  try {
    const { mois, annee } = req.query;
    let query = 'SELECT * FROM evenements WHERE traiteur_id=$1';
    const params = [req.params.traiteur_id];
    if (mois && annee) {
      query += ' AND EXTRACT(MONTH FROM date_event)=$2 AND EXTRACT(YEAR FROM date_event)=$3';
      params.push(mois, annee);
    }
    query += ' ORDER BY date_event ASC, heure_event ASC';
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/evenements', async (req, res) => {
  try {
    const { traiteur_id, titre, type, date_event, heure_event, lieu, client_nom, client_phone, nb_personnes, montant, acompte, notes } = req.body;
    const r = await pool.query(
      `INSERT INTO evenements (traiteur_id, titre, type, date_event, heure_event, lieu, client_nom, client_phone, nb_personnes, montant, acompte, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [traiteur_id, titre, type||'commande', date_event, heure_event||null, lieu||null, client_nom||null, client_phone||null, nb_personnes||1, montant||0, acompte||0, notes||null]
    );
    res.json({ ok: true, evenement: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/evenements/:id', async (req, res) => {
  try {
    const { titre, type, date_event, heure_event, lieu, client_nom, client_phone, nb_personnes, montant, acompte, notes, statut } = req.body;
    const r = await pool.query(
      `UPDATE evenements SET titre=COALESCE($1,titre), type=COALESCE($2,type), date_event=COALESCE($3,date_event),
       heure_event=COALESCE($4,heure_event), lieu=COALESCE($5,lieu), client_nom=COALESCE($6,client_nom),
       client_phone=COALESCE($7,client_phone), nb_personnes=COALESCE($8,nb_personnes), montant=COALESCE($9,montant),
       acompte=COALESCE($10,acompte), notes=COALESCE($11,notes), statut=COALESCE($12,statut) WHERE id=$13 RETURNING *`,
      [titre, type, date_event, heure_event, lieu, client_nom, client_phone, nb_personnes, montant, acompte, notes, statut, req.params.id]
    );
    res.json({ ok: true, evenement: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/evenements/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM evenements WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// ESPACE LIVREUR
// ============================================
app.get('/livreur', (req, res) => res.sendFile(path.join(__dirname, 'public', 'livreur.html')));

// Login livreur par PIN
app.post('/api/livreur/login', async (req, res) => {
  try {
    const { livreur_id, pin } = req.body;
    const r = await pool.query('SELECT * FROM livreurs WHERE id=$1', [livreur_id]);
    const livreur = r.rows[0];
    if (!livreur) return res.status(404).json({ ok: false, error: 'Livreur introuvable' });
    const pinDB = livreur.pin || '1234';
    if (String(pin).trim() !== String(pinDB).trim()) return res.json({ ok: false, error: 'PIN incorrect' });
    const tid = livreur.traiteur_id || livreur.merchant_id;
    const tel = livreur.telephone || livreur.phone;
    res.json({ ok: true, livreur: { id: livreur.id, nom: livreur.nom.trim(), telephone: tel, transport: livreur.transport, zone: livreur.zone, disponible: livreur.disponible, traiteur_id: tid } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Livraisons actives du livreur
app.get('/api/livreur/:id/livraisons', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT lv.*, ct.client_phone, ct.client_nom, ct.adresse_livraison as adresse, ct.reference, ct.total as montant_cmd
       FROM livraisons lv
       LEFT JOIN commandes_traiteur ct ON ct.id = lv.commande_id
       WHERE lv.livreur_id=$1 AND lv.statut != 'livrée'
       ORDER BY lv.created_at DESC LIMIT 20`,
      [req.params.id]
    );
    // Merge adresse: use livraisons.adresse if exists, else commande adresse
    const rows = r.rows.map(row => ({
      ...row,
      adresse: row.adresse || row.adresse_livraison || 'À confirmer',
      montant: row.montant || row.montant_cmd || 0
    }));
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Livreur part en livraison → statut "en route"
app.post('/api/livreur/partir', async (req, res) => {
  try {
    const { livraison_id, commande_id, livreur_id } = req.body;
    // Update livraison statut
    await pool.query("UPDATE livraisons SET statut='en route' WHERE id=$1", [livraison_id]);
    // Update commande statut + notif client
    if (commande_id) {
      const cmdRes = await pool.query("UPDATE commandes_traiteur SET statut='en route' WHERE id=$1 RETURNING *", [commande_id]);
      const cmd = cmdRes.rows[0];
      if (cmd) {
        const traiteurRes = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [cmd.traiteur_id]);
        const t = traiteurRes.rows[0];
        const msg = `🚚 *Votre commande est en route !*

Réf : *${cmd.reference}*
Votre livreur arrive bientôt 🛵

_${t?.nom_boutique}_`;
        await envoyerWhatsApp(process.env.PHONE_NUMBER_ID, cmd.client_phone, msg);
      }
    }
    // Marquer livreur occupé
    await pool.query('UPDATE livreurs SET disponible=false WHERE id=$1', [livreur_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// CHAT LIVREUR ↔ TRAITEUR
// ============================================
app.get('/api/messages/nonlus/:traiteur_id', async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT livreur_id, COUNT(*) as nb FROM messages_livreur WHERE traiteur_id=$1 AND lu=false AND expediteur='livreur' GROUP BY livreur_id",
      [req.params.traiteur_id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages/:traiteur_id/:livreur_id', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM messages_livreur WHERE traiteur_id=$1 AND livreur_id=$2 ORDER BY created_at ASC',
      [req.params.traiteur_id, req.params.livreur_id]
    );
    // Marquer comme lus
    await pool.query(
      "UPDATE messages_livreur SET lu=true WHERE traiteur_id=$1 AND livreur_id=$2",
      [req.params.traiteur_id, req.params.livreur_id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { traiteur_id, livreur_id, livraison_id, expediteur, contenu } = req.body;
    const r = await pool.query(
      'INSERT INTO messages_livreur (traiteur_id, livreur_id, livraison_id, expediteur, contenu) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [traiteur_id, livreur_id, livraison_id||null, expediteur, contenu]
    );
    res.json({ ok: true, message: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// ============================================
// PHOTO PREUVE DE LIVRAISON
// ============================================
app.post('/api/livraisons/:id/photo', async (req, res) => {
  try {
    const { photo_base64 } = req.body;
    await pool.query('UPDATE livraisons SET photo_preuve=$1 WHERE id=$2', [photo_base64, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// STATS AVANCÉES LIVREURS
// ============================================
app.get('/api/livreurs/:traiteur_id/stats', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT 
        l.id, l.nom, l.transport, l.zone, l.disponible,
        COUNT(lv.id) as total_livraisons,
        SUM(CASE WHEN lv.statut='livrée' THEN 1 ELSE 0 END) as livrees,
        COALESCE(AVG(lv.duree_minutes) FILTER (WHERE lv.duree_minutes IS NOT NULL), 0) as temps_moyen,
        COALESCE(SUM(lv.montant) FILTER (WHERE lv.statut='livrée'), 0) as revenus_total,
        COUNT(CASE WHEN lv.created_at > NOW() - INTERVAL '7 days' THEN 1 END) as livraisons_semaine,
        COUNT(CASE WHEN DATE(lv.created_at) = CURRENT_DATE THEN 1 END) as livraisons_today
       FROM livreurs l
       LEFT JOIN livraisons lv ON lv.livreur_id = l.id
       WHERE l.traiteur_id=$1 OR l.merchant_id=$1
       GROUP BY l.id, l.nom, l.transport, l.zone, l.disponible
       ORDER BY livrees DESC`,
      [req.params.traiteur_id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// PLANNING LIVREURS DU JOUR
// ============================================
app.get('/api/livreurs/:traiteur_id/planning', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT lv.*, l.nom as livreur_nom, l.transport, l.telephone,
              ct.client_nom, ct.client_phone, ct.adresse_livraison, ct.reference, ct.total as montant_cmd
       FROM livraisons lv
       JOIN livreurs l ON l.id = lv.livreur_id
       LEFT JOIN commandes_traiteur ct ON ct.id = lv.commande_id
       WHERE (l.traiteur_id=$1 OR l.merchant_id=$1)
       AND DATE(lv.created_at) = CURRENT_DATE
       ORDER BY lv.created_at DESC`,
      [req.params.traiteur_id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Terminer livraison avec durée calculée automatiquement
app.put('/api/livraisons/:id/terminer', async (req, res) => {
  try {
    const lv = await pool.query(
      `UPDATE livraisons SET statut='livrée', livree_at=NOW(),
       duree_minutes=EXTRACT(EPOCH FROM (NOW()-created_at))/60
       WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (lv.rows[0]) {
      await pool.query('UPDATE livreurs SET disponible=true WHERE id=$1', [lv.rows[0].livreur_id]);
      if (lv.rows[0].commande_id) {
        await pool.query("UPDATE commandes_traiteur SET statut='livré' WHERE id=$1", [lv.rows[0].commande_id]);
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vérifier code confirmation livraison
app.post('/api/livraisons/:id/confirmer-code', async (req, res) => {
  try {
    const { code } = req.body;
    const r = await pool.query('SELECT * FROM livraisons WHERE id=$1', [req.params.id]);
    const lv = r.rows[0];
    if (!lv) return res.json({ ok: false, error: 'Livraison introuvable' });
    if (!lv.code_confirmation) return res.json({ ok: true, message: 'Pas de code requis' });
    if (String(lv.code_confirmation).trim() !== String(code).trim()) return res.json({ ok: false, error: 'Code incorrect' });
    // Terminer livraison automatiquement
    await pool.query("UPDATE livraisons SET statut='livrée', livree_at=NOW(), duree_minutes=EXTRACT(EPOCH FROM (NOW()-created_at))/60 WHERE id=$1", [req.params.id]);
    await pool.query('UPDATE livreurs SET disponible=true WHERE id=$1', [lv.livreur_id]);
    if (lv.commande_id) await pool.query("UPDATE commandes_traiteur SET statut='livré' WHERE id=$1", [lv.commande_id]);
    res.json({ ok: true, message: '✅ Livraison confirmée !' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vérifier code confirmation client
app.post('/api/livraisons/:id/confirmer-code', async (req, res) => {
  try {
    const { code } = req.body;
    const lv = await pool.query('SELECT * FROM livraisons WHERE id=$1', [req.params.id]);
    if (!lv.rows[0]) return res.json({ ok: false, error: 'Livraison introuvable' });
    const codeDB = lv.rows[0].code_confirmation;
    if (!codeDB) return res.json({ ok: true, skip: true }); // Pas de code = validation directe
    if (String(code).trim() !== String(codeDB).trim()) return res.json({ ok: false, error: 'Code incorrect' });
    // Terminer livraison automatiquement
    await pool.query(`UPDATE livraisons SET statut='livrée', livree_at=NOW(), duree_minutes=EXTRACT(EPOCH FROM (NOW()-created_at))/60 WHERE id=$1`, [req.params.id]);
    await pool.query('UPDATE livreurs SET disponible=true WHERE id=$1', [lv.rows[0].livreur_id]);
    if (lv.rows[0].commande_id) await pool.query("UPDATE commandes_traiteur SET statut='livré' WHERE id=$1", [lv.rows[0].commande_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT position GPS livreur
app.put('/api/livreur/:id/position', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    await pool.query(
      'UPDATE livreurs SET latitude=$1, longitude=$2, position_at=NOW() WHERE id=$3',
      [latitude, longitude, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET positions livreurs actifs pour la carte (avec livraison en cours)
app.get('/api/carte/livreurs', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.id, l.nom, l.transport, l.latitude, l.longitude, l.position_at, l.traiteur_id, l.merchant_id
       FROM livreurs l
       WHERE l.latitude IS NOT NULL AND l.longitude IS NOT NULL
       AND l.disponible = false
       AND l.position_at > NOW() - INTERVAL '5 minutes'`
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/carte', (req, res) => res.sendFile(path.join(__dirname, 'public', 'carte.html')));

// API carte publique
app.get('/api/carte', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, nom_boutique, proprietaire, ville, type_cuisine, logo_emoji, 
             description, zone_livraison, whatsapp, latitude, longitude, adresse,
             facebook, instagram, tiktok, site_web
      FROM traiteurs 
      WHERE actif=true 
      ORDER BY nom_boutique
    `);
    res.json(r.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Mise à jour coordonnées GPS traiteur
app.put('/api/traiteur/:id/gps', async (req, res) => {
  try {
    const { latitude, longitude, adresse } = req.body;
    await pool.query(
      'UPDATE traiteurs SET latitude=$1, longitude=$2, adresse=$3 WHERE id=$4',
      [latitude, longitude, adresse, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
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
    const idParam = req.params.id;
    const r = await pool.query('SELECT * FROM commandes_traiteur WHERE id=$1 OR reference=$2', [isNaN(idParam)?null:idParam, idParam]);
    const cmd = r.rows[0];
    if (!cmd) return res.status(404).send('Commande introuvable');
    const t = await pool.query('SELECT * FROM traiteurs WHERE id=$1', [cmd.traiteur_id]);
    const traiteur = t.rows[0];
    const items = Array.isArray(cmd.items) ? cmd.items : JSON.parse(cmd.items || '[]');
    const date = new Date(cmd.created_at).toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'});
    const dateHeure = new Date(cmd.created_at).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
    const subtotal = items.reduce((s,i) => s + (i.prix * i.quantite), 0);
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Facture ${cmd.reference || '#'+cmd.id} — ${traiteur?.nom_boutique || 'TraiteurPro'}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700;900&family=Jost:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Jost',sans-serif;background:#F5F0E8;color:#1A1008;min-height:100vh;padding:32px 16px}
.page{max-width:600px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(26,16,8,0.12)}
.top-bar{background:linear-gradient(135deg,#8B1A1A,#A52A2A);padding:28px 32px;color:#fff}
.top-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}
.top-label{font-size:9px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-bottom:4px;font-weight:700}
.top-nom{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700;color:#fff;margin-bottom:4px}
.top-sub{font-size:11px;color:rgba(255,255,255,0.65)}
.facture-block{background:rgba(0,0,0,0.2);border-radius:12px;padding:14px 18px;text-align:right;min-width:180px}
.facture-label{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.6);font-weight:700;margin-bottom:6px}
.facture-num{font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#E8C97E;word-break:break-all}
.facture-date{font-size:11px;color:rgba(255,255,255,0.7);margin-top:4px}
.body{padding:28px 32px}
.section{margin-bottom:24px}
.section-title{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#A89880;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #E8DDD0}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.info-box{background:#FAF7F2;border:1px solid #E8DDD0;border-radius:10px;padding:12px}
.info-label{font-size:9px;font-weight:700;color:#A89880;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.info-val{font-size:13px;font-weight:600;color:#1A1008}
table{width:100%;border-collapse:collapse;margin-bottom:0}
thead tr{background:#FAF7F2}
th{padding:10px 12px;text-align:left;font-size:9px;font-weight:700;color:#A89880;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #E8DDD0}
th:last-child{text-align:right}
td{padding:12px;font-size:13px;color:#1A1008;border-bottom:1px solid #F5F0E8}
td:last-child{text-align:right;font-weight:700;color:#8B1A1A}
.total-section{background:#FAF7F2;border-radius:12px;padding:16px;margin-top:16px}
.total-row-item{display:flex;justify-content:space-between;font-size:13px;color:#6B5B45;margin-bottom:8px}
.total-final{display:flex;justify-content:space-between;padding-top:12px;border-top:2px solid #E8DDD0;margin-top:4px}
.total-final-label{font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#1A1008}
.total-final-val{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:#8B1A1A}
.statut-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700}
.statut-nouveau{background:#FFF3CD;color:#856404;border:1px solid #FFEAA7;font-weight:700}
.statut-confirme{background:#D4EDDA;color:#155724;border:1px solid #C3E6CB;font-weight:700}
.statut-preparation{background:#CCE5FF;color:#004085;border:1px solid #B8DAFF;font-weight:700}
.statut-route{background:#E2D9F3;color:#6F42C1;border:1px solid #D4C5F9;font-weight:700}
.statut-livre{background:rgba(45,106,79,0.12);color:#2D6A4F;border:1px solid rgba(45,106,79,0.25);font-weight:700}
.statut-annule{background:#F8D7DA;color:#721C24;border:1px solid #F5C6CB;font-weight:700}
.footer{background:linear-gradient(135deg,#FAF7F2,#F5F0E8);border-top:1px solid #E8DDD0;padding:20px 32px;text-align:center}
.footer-nom{font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:700;color:#8B1A1A;margin-bottom:4px}
.footer-sub{font-size:11px;color:#A89880}
.print-btn{display:block;text-align:center;margin:20px auto;padding:12px 28px;background:#8B1A1A;color:#fff;border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:'Jost',sans-serif}
@media print{
  body{background:#fff;padding:0}
  .page{box-shadow:none;border-radius:0}
  .print-btn{display:none}
}
</style></head><body>
<div class="page">
  <div class="top-bar">
    <div class="top-header">
      <div>
        <div class="top-label">TraiteurPro 🇸🇳</div>
        <div class="top-nom">${traiteur?.logo_emoji||'🍽️'} ${traiteur?.nom_boutique||'Traiteur'}</div>
        <div class="top-sub">📍 ${[traiteur?.ville, traiteur?.zone_livraison].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ') || 'Dakar'}</div>
        ${traiteur?.whatsapp?`<div class="top-sub">📱 ${traiteur.whatsapp}</div>`:''}
      </div>
      <div class="facture-block">
        <div class="facture-label">Facture</div>
        <div class="facture-num">${cmd.reference||'#'+cmd.id}</div>
        <div class="facture-date">📅 ${date}</div>
        <div class="facture-date">🕐 ${dateHeure}</div>
      </div>
    </div>
  </div>
  <div class="body">
    <div class="section">
      <div class="section-title">Informations</div>
      <div class="info-grid">
        <div class="info-box">
          <div class="info-label">Client</div>
          <div class="info-val">${cmd.client_nom||'—'}</div>
          <div style="font-size:11px;color:#A89880;margin-top:2px">📱 ${(cmd.client_phone||'—').replace(/^221(\d{2})(\d{3})(\d{2})(\d{2})$/,'+221 $1 $2 $3 $4')}</div>
        </div>
        <div class="info-box">
          <div class="info-label">Livraison</div>
          <div class="info-val" style="font-size:12px">${cmd.adresse_livraison||'À emporter'}</div>
          ${cmd.date_livraison?`<div style="font-size:11px;color:#A89880;margin-top:2px">📅 ${new Date(cmd.date_livraison).toLocaleDateString('fr-FR')}</div>`:''}
        </div>
        <div class="info-box">
          <div class="info-label">Statut</div>
          <div style="margin-top:4px"><span class="statut-badge ${{nouveau:'statut-nouveau',confirmé:'statut-confirme',preparation:'statut-preparation','en route':'statut-route',livré:'statut-livre',annulé:'statut-annule'}[cmd.statut]||'statut-nouveau'}">${{nouveau:'🕐 Nouveau',confirmé:'✅ Confirmé',preparation:'👨‍🍳 Préparation','en route':'🚚 En route',livré:'✅ Livré',annulé:'❌ Annulé'}[cmd.statut]||cmd.statut}</span></div>
        </div>
        <div class="info-box">
          <div class="info-label">Référence</div>
          <div class="info-val">${cmd.reference||'#'+cmd.id}</div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Détail de la commande</div>
      <table>
        <thead><tr><th>Plat</th><th>Qté</th><th>Prix unit.</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map(i=>{const n=(i.nom||'Plat').replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}]\s*/u,'').trim();return`<tr><td>${i.emoji&&i.emoji!=='🍽️'?i.emoji:''} ${n||i.nom||'Plat'}</td><td style="color:#6B5B45">${i.quantite}</td><td style="color:#6B5B45">${Number(i.prix).toLocaleString('fr-FR')} F</td><td>${Number(i.prix*i.quantite).toLocaleString('fr-FR')} F</td></tr>`;}).join('')}
        </tbody>
      </table>
      <div class="total-section">
        <div class="total-row-item"><span>Sous-total</span><span>${Number(subtotal).toLocaleString('fr-FR')} FCFA</span></div>
        <div class="total-row-item"><span>Livraison</span><span>Incluse</span></div>
        <div class="total-final">
          <span class="total-final-label">Total à payer</span>
          <span class="total-final-val">${Number(cmd.total).toLocaleString('fr-FR')} FCFA</span>
        </div>
      </div>
    </div>
  </div>
  <div style="padding:16px 32px;background:#FAF7F2;border-top:1px solid #E8DDD0">
    <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#A89880;margin-bottom:10px">Conditions de paiement</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;background:#fff;border:1px solid #E8DDD0;border-radius:10px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;color:#1A1008;margin-bottom:2px">📱 Wave</div>
        <div style="font-size:11px;color:#6B5B45">${traiteur?.whatsapp||'Contactez-nous'}</div>
      </div>
      <div style="flex:1;min-width:140px;background:#fff;border:1px solid #E8DDD0;border-radius:10px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;color:#1A1008;margin-bottom:2px">📳 Orange Money</div>
        <div style="font-size:11px;color:#6B5B45">${traiteur?.whatsapp||'Contactez-nous'}</div>
      </div>
    </div>
  </div>
  <div class="footer">
    <div class="footer-nom">${traiteur?.nom_boutique||'TraiteurPro'}</div>
    <div class="footer-sub">Merci de votre confiance ! 🙏 · TraiteurPro 🇸🇳</div>
  </div>
</div>
<button class="print-btn" onclick="window.print()">🖨️ Imprimer / Télécharger PDF</button>
</body></html>`;
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
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS facebook TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS instagram TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS tiktok TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS youtube TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS site_web TEXT;
    CREATE TABLE IF NOT EXISTS avis (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      client_nom VARCHAR(100),
      client_phone VARCHAR(20),
      note INTEGER CHECK(note BETWEEN 1 AND 5),
      commentaire TEXT,
      commande_ref VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS echelonnes (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      nom VARCHAR(200) NOT NULL,
      description TEXT,
      client_phone VARCHAR(20),
      total DECIMAL(12,2) NOT NULL,
      acompte DECIMAL(12,2) DEFAULT 0,
      date_solde DATE,
      statut VARCHAR(20) DEFAULT 'en_cours',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS evenements (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      titre VARCHAR(200) NOT NULL,
      type VARCHAR(50) DEFAULT 'commande',
      date_event DATE NOT NULL,
      heure_event TIME,
      lieu TEXT,
      client_nom VARCHAR(100),
      client_phone VARCHAR(20),
      nb_personnes INTEGER DEFAULT 1,
      montant DECIMAL(12,2) DEFAULT 0,
      acompte DECIMAL(12,2) DEFAULT 0,
      notes TEXT,
      statut VARCHAR(30) DEFAULT 'planifie',
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS adresse TEXT;
    CREATE TABLE IF NOT EXISTS livreurs (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      telephone TEXT NOT NULL,
      transport TEXT DEFAULT 'Moto',
      zone TEXT,
      disponible BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS traiteur_id INTEGER;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS telephone TEXT;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS transport TEXT DEFAULT 'Moto';
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS zone TEXT;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS disponible BOOLEAN DEFAULT true;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS pin VARCHAR(10) DEFAULT '1234';
    UPDATE livreurs SET traiteur_id = merchant_id WHERE traiteur_id IS NULL AND merchant_id IS NOT NULL;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS position_at TIMESTAMP;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS photo_preuve TEXT;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS code_confirmation VARCHAR(10);
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS code_confirmation VARCHAR(10);
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS duree_minutes INTEGER;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS note_client INTEGER;
    CREATE TABLE IF NOT EXISTS messages_livreur (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      livreur_id INTEGER NOT NULL,
      livraison_id INTEGER,
      expediteur VARCHAR(20) NOT NULL,
      contenu TEXT NOT NULL,
      lu BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS traiteur_id INTEGER;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS montant INTEGER DEFAULT 0;
    -- Renommer merchant_id en traiteur_id dans livreurs si nécessaire
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='livreurs' AND column_name='merchant_id') 
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='livreurs' AND column_name='traiteur_id') THEN
        ALTER TABLE livreurs RENAME COLUMN merchant_id TO traiteur_id;
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS livraisons (
      id SERIAL PRIMARY KEY,
      livreur_id INTEGER,
      commande_id INTEGER,
      traiteur_id INTEGER,
      statut TEXT DEFAULT 'assignée',
      adresse TEXT,
      montant INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      livree_at TIMESTAMP
    );
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
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS facebook TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS instagram TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS tiktok TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS youtube TEXT;
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS site_web TEXT;
    CREATE TABLE IF NOT EXISTS avis (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      client_nom VARCHAR(100),
      client_phone VARCHAR(20),
      note INTEGER CHECK(note BETWEEN 1 AND 5),
      commentaire TEXT,
      commande_ref VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS echelonnes (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      nom VARCHAR(200) NOT NULL,
      description TEXT,
      client_phone VARCHAR(20),
      total DECIMAL(12,2) NOT NULL,
      acompte DECIMAL(12,2) DEFAULT 0,
      date_solde DATE,
      statut VARCHAR(20) DEFAULT 'en_cours',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS evenements (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      titre VARCHAR(200) NOT NULL,
      type VARCHAR(50) DEFAULT 'commande',
      date_event DATE NOT NULL,
      heure_event TIME,
      lieu TEXT,
      client_nom VARCHAR(100),
      client_phone VARCHAR(20),
      nb_personnes INTEGER DEFAULT 1,
      montant DECIMAL(12,2) DEFAULT 0,
      acompte DECIMAL(12,2) DEFAULT 0,
      notes TEXT,
      statut VARCHAR(30) DEFAULT 'planifie',
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);
    ALTER TABLE traiteurs ADD COLUMN IF NOT EXISTS adresse TEXT;
    CREATE TABLE IF NOT EXISTS livreurs (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      telephone TEXT NOT NULL,
      transport TEXT DEFAULT 'Moto',
      zone TEXT,
      disponible BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS traiteur_id INTEGER;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS telephone TEXT;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS transport TEXT DEFAULT 'Moto';
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS zone TEXT;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS disponible BOOLEAN DEFAULT true;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS pin VARCHAR(10) DEFAULT '1234';
    UPDATE livreurs SET traiteur_id = merchant_id WHERE traiteur_id IS NULL AND merchant_id IS NOT NULL;
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);
    ALTER TABLE livreurs ADD COLUMN IF NOT EXISTS position_at TIMESTAMP;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS photo_preuve TEXT;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS code_confirmation VARCHAR(10);
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS code_confirmation VARCHAR(10);
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS duree_minutes INTEGER;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS note_client INTEGER;
    CREATE TABLE IF NOT EXISTS messages_livreur (
      id SERIAL PRIMARY KEY,
      traiteur_id INTEGER NOT NULL,
      livreur_id INTEGER NOT NULL,
      livraison_id INTEGER,
      expediteur VARCHAR(20) NOT NULL,
      contenu TEXT NOT NULL,
      lu BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS traiteur_id INTEGER;
    ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS montant INTEGER DEFAULT 0;
    -- Renommer merchant_id en traiteur_id dans livreurs si nécessaire
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='livreurs' AND column_name='merchant_id') 
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='livreurs' AND column_name='traiteur_id') THEN
        ALTER TABLE livreurs RENAME COLUMN merchant_id TO traiteur_id;
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS livraisons (
      id SERIAL PRIMARY KEY,
      livreur_id INTEGER,
      commande_id INTEGER,
      traiteur_id INTEGER,
      statut TEXT DEFAULT 'assignée',
      adresse TEXT,
      montant INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      livree_at TIMESTAMP
    );
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
