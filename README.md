# SwitchBot for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that controls
[SwitchBot](https://www.switch-bot.com) devices through the official
[SwitchBot cloud API v1.1](https://github.com/OpenWonderLabs/SwitchBotAPI), with the token and
the secret key of the SwitchBot app. Bluetooth devices go through a SwitchBot hub, like in the
SwitchBot app.

> **Developed without the hardware: feedback welcome.** The integration is built and tested
> against the responses documented by SwitchBot and the test data of the Home Assistant
> `switchbot_cloud` integration, not against physical devices nor a real SwitchBot account. Please
> report what works and what does not in the
> [issues](https://github.com/guim31/gladys-switchbot/issues).

## Features

- **Devices** (one Gladys device per SwitchBot device, added from the Discovery tab):
  - Bot (press or switch mode), Plug, Plug Mini US/JP/EU and Relay Switch 1/1PM (on/off, power,
    voltage, current, energy of the day);
  - Curtain, Curtain 3, Roller Shade, Blind Tilt (position, open, close, stop);
  - Lock, Lock Pro, Lock Ultra, Lock Vision... (lock state, door, battery; locking and unlocking
    only when the user allows it);
  - Meter, Meter Plus, Outdoor Meter, Meter Pro, Meter Pro CO2, Hub 2, Hub 3 (temperature,
    humidity, CO2, light level, battery);
  - Contact, Motion and Water Leak sensors;
  - Color Bulb, Strip Light, Strip Light 3, Floor Lamp, RGBIC(WW) lights, Ceiling Light (Pro);
  - Humidifier, Air Purifier, circulator fans, robot vacuums (basic control);
  - optionally, the virtual **IR remotes** of the hubs (power button, last command).
- **Quota-aware refresh**: SwitchBot allows 10,000 calls a day per account. The container polls
  the added devices itself, at a pace sized on their number so that polling uses half of the
  quota at most; it counts its calls (saved under `/data`) and pauses polling near the limit.
- **Real time through Gladys Plus** (optional): the SwitchBot webhook is relayed by Gladys Plus;
  each event triggers a read of the device that changed.
- **Scene triggers**: door or window opened, closed or _left open_; motion detected; water leak;
  battery low.
- **Scene actions**: _Press a SwitchBot Bot_; _Send a SwitchBot IR command_ (standard commands
  or custom buttons).
- **Dashboard widget** "SwitchBot": temperatures, open doors and windows, locks, water leaks, low
  batteries, API calls of the day.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later, with Internet access.
- A SwitchBot account, the SwitchBot app (version 9 or later) and, for Bluetooth devices, a
  SwitchBot hub with Cloud Services turned on for each device.
- Optional: Gladys Plus, for real time.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter
   `https://github.com/guim31/gladys-switchbot` (or install it from the catalog once listed).
2. In the SwitchBot app: **Profile** → **Preferences** → **About**, tap **App Version** 10 times,
   then **Developer Options**: copy the token and the secret key.
3. Paste them in the integration **Configuration**, save, then add your devices from the
   **Discovery** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- One `GET /v1.1/devices` on start, on reconnection, on a new configuration and on a search from
  the Discovery tab; one `GET /v1.1/devices/{id}/status` per added device per period; commands
  through `POST /v1.1/devices/{id}/commands`. Every request is signed (HMAC-SHA256 of token,
  timestamp and nonce with the secret key).
- The devices are published with `should_poll: true` and a one-minute `poll_frequency`, but the
  container polls by itself (`src/poller.js`): the core does not poll external devices reliably
  (GladysAssistant/Gladys#3198); the core's `onPoll` is a fallback, skipped while the timer runs.
- Only changed values are published (SDK deduplication), with a heartbeat every 6 hours; after a
  command, the expected state is published at once and the device is read again a few seconds
  later.
- External ids are built from the SwitchBot `deviceId`: `ext:<selector>:device:<deviceId>`
  (`remote:` for an IR remote), plus the feature key.
- Logs stay quiet: nothing at info level for a normal cycle, one line per user action, a repeated
  failure once when it starts and once when it ends; `LOG_LEVEL=debug` shows every read. The token,
  the secret key and the Gladys Plus URL are never logged.

## Limitations

- Cloud only: no local Bluetooth, the SwitchBot servers must answer.
- Values are refreshed every few minutes (quota), not instantly, unless the Gladys Plus real time
  is on — and SwitchBot keeps a single webhook URL per account: enabling it replaces the URL of
  another app (Home Assistant...).
- The SwitchBot API is for personal use.
- No state for IR remotes; no cleaning programs for the newer robot vacuums; no fan modes, night
  lights, child locks; no keypads, cameras, video doorbells, thermostats, Relay Switch 2PM, garage
  door opener yet.
- The quota count only sees the integration's own calls.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test, on the SDK's fake Gladys and a fake SwitchBot cloud
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
```

```
index.js                  SDK wiring (src/app.js registers the handlers)
src/hub.js                discovery, reads, states, commands, scene events
src/poller.js             the container's polling timer
src/quota.js              daily call count and polling pace
src/webhook.js            SwitchBot webhook through Gladys Plus
src/switchbot/client.js   signed client of the SwitchBot API v1.1
src/devices/              one file per device family, catalog in index.js
src/events.js             scene triggers
src/scenes.js             scene actions
src/widgets.js            "SwitchBot" dashboard widget
src/i18n.js               feature names and messages in four languages
test/fixtures/switchbot/  documented API responses, invented ids
```

`test/gladys-rules.test.js` checks every discovered device against the category/type table
extracted from the Gladys core.

Releases are made by the **Release** workflow (Actions → Release); never edit the versions by
hand. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- The [SwitchBot API documentation](https://github.com/OpenWonderLabs/SwitchBotAPI) by
  OpenWonderLabs: endpoints, signature, device fields and commands.
- Home Assistant's
  [`switchbot_cloud`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/switchbot_cloud)
  integration (Apache-2.0): the real `deviceType` values, the status fields and test fixtures
  reused (with invented ids) in `test/fixtures/switchbot/`, the cover and lock conversions, the
  webhook handling.
- [py-switchbot-api](https://github.com/SeraphicCorp/py-switchbot-api) by Seraphic Corp (MIT):
  device list and status fixtures, command names.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by SwitchBot (Wonderlabs, Inc.).
"SwitchBot" is a trademark of its owner.

## License

Apache-2.0
