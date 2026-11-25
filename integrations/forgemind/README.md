# ForgeMind host management

The admin console exposes `/forgemind/hosts` for one configured owner and management tenant. Each list entry is a worker identity registered in the selected Autoloop Hub. Its current heartbeat and its virtual machine's power state are independent.

## Deployment settings

On the BiSheng API service, set `FORGEMIND_OWNER_ID` to the owner's numeric BiSheng user ID, `FORGEMIND_TENANT_ID` to the authorized management tenant ID, and `FORGEMIND_CONTROLLER` to an OpenSSH host alias. An unconfigured integration is hidden. Mount the SSH configuration, dedicated identity and pinned known-hosts file into the API container from the site's credential store. The alias must reach the controller non-interactively. Bind the API's public key to a single forced command in the controller account's authorized keys:

```text
restrict,command="/usr/local/bin/forgemind-host-manager" ssh-ed25519 <dedicated public key>
```

Install `host_manager.py` on the Autoloop controller as that executable. Run it as the account which owns this Hub and its trusted management identities, using Python 3.11 or later. Use a private configuration at `/etc/forgemind/host-manager.json`. This example uses deployment placeholders:

```json
{
  "state": "/var/lib/forgemind/host-requests",
  "hub_db": "~/.agent-autoloop/hub.db",
  "status_cli": ["/opt/bin/agent-autoloop"],
  "enroll_cli": "/opt/bin/agent-autoloop",
  "hypervisor": "worker-hypervisor",
  "pool": "ci-template-source",
  "images": [{"file": "forgemind-worker-v1.qcow2", "label": "ForgeMind v1"}],
  "uplink": "user-lan",
  "create_script": "/opt/forgemind/create-guest.sh",
  "hypervisor_public_key": "/etc/forgemind/controller.pub",
  "management_identity": "/var/lib/forgemind/ssh/management",
  "connect_script": "/opt/forgemind/connect.py",
  "hub_address": "controller.internal",
  "bindings": {}
}
```

Set the real paths and network interface at the site. The controller's own OpenSSH alias `hypervisor` uses a pinned host key and the existing libvirt operator account. The hypervisor needs the dual-NIC ForgeMind `create-guest.sh` with its adjacent `user_network.py`, the allowed template pool, and the controller's **public** management key. The controller needs the matching private management identity and ForgeMind's `connect.py`. Optionally specify the site's approved `model_settings` path on the controller. Provision `state` as a directory writable only by the controller account. It stores private creation receipts and per-instance SSH profiles. Hub registration and libvirt stay authoritative for live state.

When restricting SSH on the hypervisor, permit the create recipe with its three positional arguments, and the same invocation with the site's validated `--user-ip` and `--user-uplink` pair. Both use platform DHCP for enrollment. Only the second invocation attaches the user network.

## Deploying on BiSheng v3.0.2

Build the administrator frontend against the site's **v3.0.2** source and lockfile. Its management-session API differs from the v3.1 frontend. Apply the host menu and route changes to the release layout and routes, copy the ForgeMind page and API client, and merge only the `hosts` translation object into each release locale. Keep the release's original dashboards and user workspace.

Backport the ForgeMind API package and register its router on the existing v1 router. The v3.0.2 middleware and request client use explicit management route lists. Apply [the v3.0.2 scope patch](compat/3.0.2-management-scope.patch) to both before deployment. The owner and selected management tenant must match. Writes carry the native expected-tenant header and fail closed if the management selection changes. Verify the existing dashboard, the authenticated owner menu, member denial, and a creation on an allocated address after deployment.

## Member and project management

Deploy the matching ForgeMind project-console code alongside this controller. Run the fixed command with that Python environment and the ForgeMind checkout on its import path. Set `FORGEMIND_PROJECTS_ENABLED=1` on the BiSheng API after configuring the assistant catalog on the controller. The project and member screens share the host page's authorized owner and management tenant. Disabling an account or removing its active membership invokes the same controller to revoke Feishu access. On v3.0.2, backport both screens, the native account creation callback, the account lifecycle hooks and the `fmTeam` locale entries together with the management-scope patch. Commissioning settings and the development-worker QA recipe are described in the ForgeMind repository in `docs/bisheng-member-project-integration.md`.

## Existing hosts and recovery

Any registered worker is visible, including an external worker without a libvirt domain. Same-name domains can be read. For an existing ForgeMind acceptance receipt, set `bindings[worker].receipt` to the controller-local JSON path. The reader checks `hub_worker` and `vm.domain` and uses the recorded `vm.uuid` and image. For older hosts, supply the verified `uuid` and optional `image` directly. To enable connection checks add the pinned `ssh_config` resolving the worker name to its actual guest. Hosts created through the page receive their binding automatically.

Creation validates allowed images and the user subnet, launches the existing dual-NIC script, pins the guest's returned public host key, and calls the native enrollment flow. The request ID lets a browser reconnect to a running creation. Once its domain UUID is recorded, a retry verifies that UUID and reuses the VM. A pre-existing or ambiguous instance is reported as a conflict. The creation view finishes after observing a fresh Hub heartbeat. For an older single-NIC VM the user address is unconfigured; its platform DHCP lease is shown separately.
