// -----------------------------------------------------------------------------
// Every text the integration produces, in the four languages of the Gladys
// interface: English, French, German (informal "du") and Spanish (formal
// "usted"). The words follow the Gladys interface (front/src/config/i18n).
//
// Feature names are given once, when a device is added to Gladys, in the
// language of the `language` setting (a device integration does not receive
// the user's language). The other texts are multi-language objects: Gladys
// shows the one of the user.
// -----------------------------------------------------------------------------

export const NAMES = {
  en: {
    power: 'Power',
    bot: 'Press / switch',
    battery: 'Battery',
    temperature: 'Temperature',
    humidity: 'Humidity',
    lightLevel: 'Light level (1-20)',
    co2: 'CO2',
    position: 'Position',
    coverState: 'Open / close',
    lock: 'Lock',
    lockState: 'Lock state',
    door: 'Door',
    contact: 'Opening',
    motion: 'Motion',
    leak: 'Water leak',
    light: 'Light',
    brightness: 'Brightness',
    color: 'Color',
    colorTemperature: 'Color temperature',
    powerUsage: 'Power draw',
    voltage: 'Voltage',
    current: 'Current',
    energyToday: 'Energy today',
    mode: 'Mode',
    fanSpeed: 'Fan speed',
    waterTank: 'Water tank',
    vacuumState: 'State',
    vacuumRun: 'Cleaning',
    dock: 'Return to base',
    lastCommand: 'Last command',
  },
  fr: {
    power: 'Marche/arrêt',
    bot: 'Appui / interrupteur',
    battery: 'Batterie',
    temperature: 'Température',
    humidity: 'Humidité',
    lightLevel: 'Luminosité (1-20)',
    co2: 'CO2',
    position: 'Position',
    coverState: 'Ouvrir / fermer',
    lock: 'Verrouillage',
    lockState: 'État de la serrure',
    door: 'Porte',
    contact: 'Ouverture',
    motion: 'Mouvement',
    leak: "Fuite d'eau",
    light: 'Éclairage',
    brightness: 'Luminosité',
    color: 'Couleur',
    colorTemperature: 'Température de couleur',
    powerUsage: 'Puissance consommée',
    voltage: 'Tension',
    current: 'Intensité',
    energyToday: 'Consommation du jour',
    mode: 'Mode',
    fanSpeed: 'Vitesse',
    waterTank: "Réservoir d'eau",
    vacuumState: 'État',
    vacuumRun: 'Nettoyage',
    dock: 'Retour à la base',
    lastCommand: 'Dernière commande',
  },
  de: {
    power: 'Ein/Aus',
    bot: 'Drücken / Schalter',
    battery: 'Batterie',
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    lightLevel: 'Helligkeit (1-20)',
    co2: 'CO2',
    position: 'Position',
    coverState: 'Öffnen / Schließen',
    lock: 'Verriegelung',
    lockState: 'Schlossstatus',
    door: 'Tür',
    contact: 'Kontakt',
    motion: 'Bewegung',
    leak: 'Wasserleck',
    light: 'Licht',
    brightness: 'Helligkeit',
    color: 'Farbe',
    colorTemperature: 'Farbtemperatur',
    powerUsage: 'Leistungsverbrauch',
    voltage: 'Spannung',
    current: 'Strom',
    energyToday: 'Verbrauch heute',
    mode: 'Modus',
    fanSpeed: 'Geschwindigkeit',
    waterTank: 'Wassertank',
    vacuumState: 'Betriebszustand',
    vacuumRun: 'Reinigung',
    dock: 'Zurück zur Ladestation',
    lastCommand: 'Letzter Befehl',
  },
  es: {
    power: 'Encendido/apagado',
    bot: 'Pulsar / interruptor',
    battery: 'Batería',
    temperature: 'Temperatura',
    humidity: 'Humedad',
    lightLevel: 'Luminosidad (1-20)',
    co2: 'CO2',
    position: 'Posición',
    coverState: 'Abrir / cerrar',
    lock: 'Bloqueo',
    lockState: 'Estado de la cerradura',
    door: 'Puerta',
    contact: 'Apertura',
    motion: 'Movimiento',
    leak: 'Fuga de agua',
    light: 'Luz',
    brightness: 'Brillo',
    color: 'Color',
    colorTemperature: 'Temperatura de color',
    powerUsage: 'Consumo eléctrico',
    voltage: 'Tensión',
    current: 'Corriente',
    energyToday: 'Consumo de hoy',
    mode: 'Modo',
    fanSpeed: 'Velocidad',
    waterTank: 'Depósito de agua',
    vacuumState: 'Estado de funcionamiento',
    vacuumRun: 'Limpieza',
    dock: 'Volver a la base',
    lastCommand: 'Último comando',
  },
};

// Labels of the options of the select features, by option list.
export const OPTION_LABELS = {
  en: { purifierModes: { normal: 'Normal', auto: 'Auto', sleep: 'Sleep', pet: 'Pet' } },
  fr: { purifierModes: { normal: 'Normal', auto: 'Auto', sleep: 'Nuit', pet: 'Animaux' } },
  de: { purifierModes: { normal: 'Normal', auto: 'Auto', sleep: 'Schlaf', pet: 'Haustier' } },
  es: { purifierModes: { normal: 'Normal', auto: 'Auto', sleep: 'Sueño', pet: 'Mascotas' } },
};

// Status messages of the Configuration screen.
export const TEXT = {
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  notConfigured: {
    en: 'Enter the token and the secret key of the SwitchBot app.',
    fr: "Saisissez le jeton et la clé secrète de l'application SwitchBot.",
    de: 'Gib das Token und den geheimen Schlüssel der SwitchBot-App ein.',
    es: 'Introduzca el token y la clave secreta de la aplicación SwitchBot.',
  },
  authFailed: {
    en: 'SwitchBot refused the credentials: check the token and the secret key, or wait for midnight if the daily quota (10,000 calls) is spent.',
    fr: 'SwitchBot refuse les identifiants : vérifiez le jeton et la clé secrète, ou attendez minuit si le quota du jour (10 000 appels) est épuisé.',
    de: 'SwitchBot lehnt die Zugangsdaten ab: Prüfe Token und geheimen Schlüssel oder warte bis Mitternacht, falls das Tageskontingent (10.000 Aufrufe) aufgebraucht ist.',
    es: 'SwitchBot rechaza las credenciales: compruebe el token y la clave secreta, o espere a medianoche si se ha agotado la cuota diaria (10 000 llamadas).',
  },
  unreachable: {
    en: 'The SwitchBot cloud does not answer: check the Internet connection of Gladys.',
    fr: 'Le cloud SwitchBot ne répond pas : vérifiez la connexion Internet de Gladys.',
    de: 'Die SwitchBot-Cloud antwortet nicht: Prüfe die Internetverbindung von Gladys.',
    es: 'La nube de SwitchBot no responde: compruebe la conexión a Internet de Gladys.',
  },
  publishFailed: {
    en: 'Gladys refused the device list, check the integration logs.',
    fr: "Gladys a refusé la liste des appareils, consultez les logs de l'intégration.",
    de: 'Gladys hat die Geräteliste abgelehnt, sieh dir die Protokolle der Integration an.',
    es: 'Gladys ha rechazado la lista de dispositivos, consulte los registros de la integración.',
  },
};

// Pieces of the report shown under the "Test the connection" button.
export const CHECK_TEXT = {
  en: {
    notConfigured: TEXT.notConfigured.en,
    authFailed: TEXT.authFailed.en,
    unreachable: TEXT.unreachable.en,
    devices: (supported, total) => `${total} SwitchBot device(s), ${supported} supported.`,
    unsupported: (list) => `Not supported: ${list}.`,
    remotes: (count, published) =>
      `${count} IR remote(s)${published ? '' : ' (turn on the IR remotes option to add them)'}.`,
    polling: (count, minutes) =>
      count === 0
        ? 'No device added to Gladys yet: nothing is polled.'
        : `${count} device(s) polled every ${minutes} min.`,
    calls: (used) => `API calls today: ${used} of 10,000.`,
    webhookOn: 'Webhook: active, changes arrive in real time.',
    webhookNoPlus: 'Webhook: Gladys Plus is not linked, polling only.',
    webhookFailed: 'Webhook: registration failed, polling only.',
  },
  fr: {
    notConfigured: TEXT.notConfigured.fr,
    authFailed: TEXT.authFailed.fr,
    unreachable: TEXT.unreachable.fr,
    devices: (supported, total) => `${total} appareil(s) SwitchBot, ${supported} pris en charge.`,
    unsupported: (list) => `Non pris en charge : ${list}.`,
    remotes: (count, published) =>
      `${count} télécommande(s) IR${published ? '' : ' (activez l’option des télécommandes IR pour les ajouter)'}.`,
    polling: (count, minutes) =>
      count === 0
        ? "Aucun appareil ajouté à Gladys pour l'instant : rien n'est interrogé."
        : `${count} appareil(s) interrogé(s) toutes les ${minutes} min.`,
    calls: (used) => `Appels d'API aujourd'hui : ${used} sur 10 000.`,
    webhookOn: 'Webhook : actif, les changements arrivent en temps réel.',
    webhookNoPlus: "Webhook : Gladys Plus n'est pas lié, interrogation seule.",
    webhookFailed: "Webhook : l'enregistrement a échoué, interrogation seule.",
  },
  de: {
    notConfigured: TEXT.notConfigured.de,
    authFailed: TEXT.authFailed.de,
    unreachable: TEXT.unreachable.de,
    devices: (supported, total) => `${total} SwitchBot-Gerät(e), ${supported} unterstützt.`,
    unsupported: (list) => `Nicht unterstützt: ${list}.`,
    remotes: (count, published) =>
      `${count} IR-Fernbedienung(en)${published ? '' : ' (schalte die Option für IR-Fernbedienungen ein, um sie hinzuzufügen)'}.`,
    polling: (count, minutes) =>
      count === 0
        ? 'Noch kein Gerät zu Gladys hinzugefügt: Es wird nichts abgefragt.'
        : `${count} Gerät(e), alle ${minutes} Min. abgefragt.`,
    calls: (used) => `API-Aufrufe heute: ${used} von 10.000.`,
    webhookOn: 'Webhook: aktiv, Änderungen kommen in Echtzeit an.',
    webhookNoPlus: 'Webhook: Gladys Plus ist nicht verknüpft, nur Abfrage.',
    webhookFailed: 'Webhook: Registrierung fehlgeschlagen, nur Abfrage.',
  },
  es: {
    notConfigured: TEXT.notConfigured.es,
    authFailed: TEXT.authFailed.es,
    unreachable: TEXT.unreachable.es,
    devices: (supported, total) => `${total} dispositivo(s) SwitchBot, ${supported} compatible(s).`,
    unsupported: (list) => `No compatibles: ${list}.`,
    remotes: (count, published) =>
      `${count} mando(s) IR${published ? '' : ' (active la opción de mandos IR para añadirlos)'}.`,
    polling: (count, minutes) =>
      count === 0
        ? 'Todavía no hay ningún dispositivo añadido a Gladys: no se consulta nada.'
        : `${count} dispositivo(s) consultado(s) cada ${minutes} min.`,
    calls: (used) => `Llamadas a la API hoy: ${used} de 10 000.`,
    webhookOn: 'Webhook: activo, los cambios llegan en tiempo real.',
    webhookNoPlus: 'Webhook: Gladys Plus no está vinculado, solo consulta periódica.',
    webhookFailed: 'Webhook: el registro ha fallado, solo consulta periódica.',
  },
};

/** One multi-language object from a function of the text table of each language. */
export function translate(table, render) {
  return Object.fromEntries(Object.entries(table).map(([lang, text]) => [lang, render(text)]));
}

/** The text of `language`, English when it is missing. */
export const pick = (value, language) => value?.[language] ?? value?.en;
