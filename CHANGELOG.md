# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.1.0] - 2026-11-17

### Fixed

- Lock Ultra and Ultra Max: the `latchBoltLocked` state (deadbolt retracted, the latch alone
  holding the door) now reads unlocked. It read locked, so an unlocked lock showed a closed padlock
  and the dashboard switch only offered to unlock. The door state reported as always open is not
  explained yet: the new diagnostic action will tell.
- "Test the connection" shows a failure (no credentials, refused credentials, cloud unreachable)
  as an error, in red, instead of a message in green.

### Added

- "Unlock the deadbolt only" button (SwitchBot `deadbolt` command, not checked on hardware) on
  the Lock, Lock Pro, Lock Ultra and Lock Ultra Max, with the "Allow locking and unlocking"
  option. A
  lock already added gets it with "Update" in the Discovery tab.
- "Device diagnostics" action in the Configuration screen: the raw status SwitchBot returns for
  each device (20 at most), identifiers masked and names left out, to paste on the forum.

## [1.0.1] - 2026-10-13

### Added

- SwitchBot devices in Gladys through the official SwitchBot cloud API (v1.1),
  with the token and the secret key of the SwitchBot app: Bot, Plug, Plug Mini
  (US, JP, EU), Relay Switch 1 and 1PM, Curtain, Curtain 3, Roller Shade, Blind
  Tilt, the Lock family (read only unless "Allow locking and unlocking" is on),
  Meter, Meter Plus, Outdoor Meter, Meter Pro, Meter Pro CO2, Hub 2, Hub 3,
  Contact, Motion and Water Leak sensors, Color Bulb, Strip Light, Strip Light 3,
  Floor Lamp, RGBIC(WW) lights, Ceiling Light (Pro), Humidifier, Air Purifier,
  circulator fans and robot vacuums (basic control).
- The virtual infrared remotes of the hubs, as an option: a power button and the
  last command sent.
- A refresh pace sized on the number of devices, to stay within half of the
  daily quota of 10,000 API calls; the calls of the day are counted (saved under
  `/data`) and polling pauses near the quota, commands keep working.
- Real time through Gladys Plus, as an option: the SwitchBot webhook triggers a
  read of the device that changed.
- Scene triggers: door or window opened, closed or left open; motion detected;
  water leak; battery low.
- Scene actions: press a Bot; send an IR command (standard or custom button).
- The "SwitchBot" dashboard widget: temperatures, open doors and windows, locks,
  water leaks, low batteries and the API calls of the day.
- A "Test the connection" button in the configuration.
- Texts in English, French, German and Spanish, and the documentation in the
  four languages.

[Unreleased]: https://github.com/guim31/gladys-switchbot/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/guim31/gladys-switchbot/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/guim31/gladys-switchbot/releases/tag/v1.0.1
