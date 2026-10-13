# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular:

- the SwitchBot **token and secret key**: they live in the Gladys
  configuration (secret fields), sign every request to the SwitchBot cloud and
  must never appear in a log line, an error message or a widget;
- the **Gladys Plus webhook URL**, which holds the user's Open API key: it is
  registered at SwitchBot when the option is on, and never logged;
- what the container writes under `/data`: only the count of the API calls of
  the day (`quota.json`), no credential;
- the network: the container only talks to the SwitchBot cloud
  (`https://api.switch-bot.com`) and to Gladys; it opens no port and does not
  reach the local network;
- the lock commands, only offered when the user turns on "Allow locking and
  unlocking".

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Gladys Plus, and the SwitchBot cloud, app and devices.
