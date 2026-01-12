# monster-ui-object-finder
=========================

Purpose
-------
Search across common Kazoo document types for references to:
- object IDs (users, devices, voicemail boxes, callflows)
- text values (email, phone number, arbitrary text)

Then display where they are used (grouped by doc type).

Install
-------
Copy this folder into your Monster UI apps directory, e.g.

  /var/www/html/monster-ui/apps/object-finder

Then rebuild/reload Monster UI if your deployment requires it.

Notes
-----
- This app uses standard Crossbar patterns via Monster callApi() and expects the following resources to exist:
  accounts/{accountId}/users, devices, vmboxes, callflows, faxboxes, directories, groups.
