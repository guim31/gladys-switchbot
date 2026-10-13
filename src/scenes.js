// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`), run when a scene reaches them.
// `fields` are the resolved values (scene variables substituted, defaults
// applied, validated by the core). Throwing fails this action only: the scene
// logs the message and goes on.
//
//   - press_bot: one press of a Bot, whatever its mode (in switch mode the
//     device feature turns it on or off; a press is what the Bot does best);
//   - send_ir_command: any button of a virtual IR remote, standard ("turnOn",
//     "volumeAdd", "setAll" with "26,1,3,on"...) or custom (the name of a
//     button created in the SwitchBot app).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async press_bot(hub, { fields }) {
    await hub.pressBot(fields.device);
  },

  async send_ir_command(hub, { fields }) {
    await hub.sendIr(fields.device, fields.command, fields.parameter);
  },
};
