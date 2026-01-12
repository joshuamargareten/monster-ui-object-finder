define(function (require) {
  var monster = require('monster'),
    $ = require('jquery'),
    _ = require('lodash');

  var app = {
    name: 'objectFinder',
    css: ['app'],
    i18n: { 'en-US': { customCss: false } },

    sdk: {
      userList: 'user.list',
      deviceList: 'device.list',
      vmboxList: 'voicemail.list',   // if yours is vmbox.list, change it
      callflowList: 'callflow.list',
      groupList: 'group.list',
      faxboxList: 'faxbox.list',
      directoryList: 'directory.list'
    },

    load: function (cb) { cb && cb(); },

    render: function (container) {
      var self = this;

      self.accountId =
        _.get(monster, 'apps.auth.currentAccount.id') ||
        _.get(monster, 'apps.auth.accountId') ||
        _.get(monster, 'apps.auth.currentAccountId');

      self.state = {
        busy: false,
        type: 'user'
      };

      var $container = _.isEmpty(container) ? $('#monster_content') : container;
      var $layout = $(self.getTemplate({
        name: 'layout',
        data: { i18n: self.i18n.active() }
      }));

      $container.empty().append($layout);

      self._bind($layout);
      self._onTypeChange($layout);
    },

    /* =========================
     * Type helpers
     * ========================= */

    _tableKeyToType: function (tableKey) {
      // Used when a function expects a “type” (user/device/callflow/...)
      // but we are iterating table keys (users/devices/callflows/...)
      var map = {
        users: 'user',
        devices: 'device',
        vmboxes: 'vmbox',
        callflows: 'callflow',
        groups: 'group',
        faxboxes: 'faxbox',
        directories: 'directory'
      };
      return map[tableKey] || tableKey;
    },

    /* =========================
     * UX helpers (Chosen enable/disable)
     * ========================= */

    _updateChosenState: function ($select) {
      if (!$select || !$select.length) return;

      if ($select.data('chosen')) {
        $select.trigger('chosen:updated');

        var disabled = $select.prop('disabled');
        var $container = $select.next('.chosen-container');
        $container.toggleClass('chosen-disabled', !!disabled);
        $container.find('input.chosen-search-input').prop('disabled', !!disabled);
      }
    },

    _setBusy: function ($layout, isBusy, progressText) {
      this.state.busy = !!isBusy;

      $layout.find('#of-progress').text(progressText || '');

      $layout.find('#of-type').prop('disabled', isBusy);
      $layout.find('#of-object-filter').prop('disabled', isBusy);
      $layout.find('#of-object-select').prop('disabled', isBusy);
      $layout.find('#of-text').prop('disabled', isBusy);

      this._updateChosenState($layout.find('#of-object-select'));

      $layout.find('#of-search').prop('disabled', isBusy || !$layout.data('of-can-search'));
    },

    _bind: function ($layout) {
      var self = this;

      $layout.find('#of-type').on('change', function () {
        self.state.type = $(this).val();
        self._onTypeChange($layout);
      });

      $layout.find('#of-object-filter').on('input', _.debounce(function () {
        self._refreshObjectSelect($layout);
      }, 150));

      $layout.find('#of-object-select').on('change', function () {
        self._updateSearchEnabled($layout);
      });

      $layout.find('#of-text').on('input', _.debounce(function () {
        self._updateSearchEnabled($layout);
      }, 50));

      $layout.find('#of-search').on('click', function () {
        self._runSearch($layout);
      });
    },

    _onTypeChange: function ($layout) {
      var self = this;
      var type = self.state.type;

      $layout.find('#of-results').empty();
      $layout.find('#of-progress').text('');
      $layout.find('#of-object-filter').val('');
      $layout.find('#of-text').val('');

      var isText = (type === 'email' || type === 'number');
      $layout.find('#of-object-block').toggle(!isText);
      $layout.find('#of-text-block').toggle(isText);

      self._setBusy($layout, false, '');

      if (isText) {
        self._updateSearchEnabled($layout);
        return;
      }

      self._setBusy($layout, true, 'Loading…');

      self._loadSourceList(type)
        .then(function (list) {
          $layout.data('of-source-list', list || []);
          self._refreshObjectSelect($layout);
          self._updateSearchEnabled($layout);
        })
        .catch(function (err) {
          monster.ui.alert('error', (err && err.message) ? err.message : 'Failed to load list');
          $layout.data('of-source-list', []);
          self._refreshObjectSelect($layout);
        })
        .then(function () {
          self._setBusy($layout, false, '');
          self._updateSearchEnabled($layout);
        });
    },

    _updateSearchEnabled: function ($layout) {
      var type = this.state.type;
      var can = false;

      if (type === 'email' || type === 'number') {
        can = !!($.trim($layout.find('#of-text').val() || ''));
      } else {
        can = !!($layout.find('#of-object-select').val());
      }

      $layout.data('of-can-search', can);

      if (!this.state.busy) {
        $layout.find('#of-search').prop('disabled', !can);
      }
    },

    _kindSuffix: function (needle, idKindMap) {
      if (!idKindMap) return '';

      var info = idKindMap[String(needle)];
      if (!info) return '';

      if (_.isString(info)) {
        return ' (' + info + ')';
      }

      var t = info.type || 'found';
      var n = info.name || '';
      return ' (' + t + (n ? (': ' + n) : '') + ')';
    },

    _foundLabel: function (needle, idKindMap) {
      if (!idKindMap) return '';
      var info = idKindMap[String(needle)];
      if (!info) return '';

      if (_.isString(info)) return info;

      var t = info.type || '';
      var n = info.name || '';
      if (t && n) return t + ': ' + n;
      return t || n || '';
    },

    _occ: function (where, foundNeedle, idKindMap) {
      return {
        found: foundNeedle ? this._foundLabel(foundNeedle, idKindMap) : '',
        where: where || ''
      };
    },

    _normOcc: function (list) {
      var self = this;
      return _.map(list || [], function (x) {
        if (_.isString(x)) return self._occ(x, null, null);
        return x;
      });
    },

    _titleize: function (str) {
      str = String(str || '').replace(/_/g, ' ');
      return str.replace(/\w\S*/g, function (w) {
        return w.charAt(0).toUpperCase() + w.substr(1).toLowerCase();
      });
    },

    _flowBreadcrumbHits: function (flow, needles, idKindMap) {
      var self = this;
      var hits = [];

      function nodeMatchesNeedles(node) {
        var data = (node && node.data) ? node.data : {};
        var hay = JSON.stringify(data);

        var matched = [];
        _.each(needles, function (n) {
          if (hay.indexOf(String(n)) >= 0) matched.push(String(n));
        });
        return matched;
      }

      function walk(node, tokens) {
        if (!node) return;

        var moduleName = self._titleize(node.module || '(module)');
        var myTokens = tokens.concat([moduleName]);

        // Special labeling for Call Forward / Call Failover when searching numbers
        var didSpecialNumberHit = false;
        if ((node.module === 'call_forward' || node.module === 'call_failover') && node.data && node.data.number) {
          var numNorm = self._normalizeNumber(String(node.data.number));
          _.each(needles, function (n) {
            var nNorm = self._normalizeNumber(String(n));
            if (nNorm && numNorm && numNorm.indexOf(nNorm) >= 0) {
              var enabled = node.data.enabled;
              var label = self._titleize(node.module) + (enabled === false ? ' (Disabled)' : ' (Enabled)');
              hits.push(self._occ(label, null, null));
              didSpecialNumberHit = true;
            }
          });
        }

        // If we already emitted the special number hit for this node, don’t also add the generic breadcrumb hit
        // (prevents duplicates like “Call Forward (Enabled)” AND “Menu > Call Forward” for the same match)
        if (!didSpecialNumberHit) {
          var matchedNeedles = nodeMatchesNeedles(node);
          if (matchedNeedles.length) {
            _.each(matchedNeedles, function (mn) {
              hits.push(self._occ(myTokens.join(' > '), mn, idKindMap));
            });
          }
        }

        var children = node.children;

        if (_.isArray(children)) {
          _.each(children, function (childNode, idx) {
            walk(childNode, myTokens.concat([String(idx)]));
          });
        } else if (_.isObject(children)) {
          _.each(children, function (childNode, key) {
            var nextTokens = myTokens.slice();
            if (key !== '_' && key !== undefined && key !== null && String(key).length) {
              nextTokens.push(String(key));
            }
            walk(childNode, nextTokens);
          });
        }
      }

      walk(flow, []);
      return hits;
    },

    _prettyPath: function (path, docType) {
      if (docType === 'faxboxes') {
        if (path.indexOf('notifications.inbound.email.send_to') === 0) return 'Inbound Notifications Email';
        if (path.indexOf('notifications.outbound.email.send_to') === 0) return 'Outbound Notifications Email';
        if (path.indexOf('smtp_permission_list') === 0) return 'SMTP Permission List';
      }

      if (docType === 'vmboxes') {
        if (path.indexOf('notify_email_addresses') === 0) return 'Voicemail Notification Email';
      }

      return path;
    },

    _refreshObjectSelect: function ($layout) {
      var self = this;
      var type = self.state.type;

      var list = $layout.data('of-source-list') || [];
      var filter = ($layout.find('#of-object-filter').val() || '').toLowerCase();
      var $select = $layout.find('#of-object-select');

      var options = _(list)
        .map(function (it) {
          var id = it.id || it._id;
          var name = self._displayName(type, it);
          return { id: id, label: name, name: name };
        })
        .filter(function (o) {
          if (!filter) return true;
          return (o.label || '').toLowerCase().indexOf(filter) >= 0;
        })
        .sortBy(function (o) { return (o.name || '').toLowerCase(); })
        .value();

      $select.empty();
      $select.append($('<option></option>').attr('value', '').text('Select…'));

      _.each(options, function (o) {
        $select.append($('<option></option>').attr('value', o.id).text(o.label));
      });

      $select.val('');

      if (!$select.data('chosen')) {
        try { monster.ui.chosen($select); } catch (e) { }
      } else {
        $select.trigger('chosen:updated');
      }

      self._updateChosenState($select);
      self._updateSearchEnabled($layout);
    },

    _displayName: function (type, it) {
      if (!it) return '(unknown)';

      if (type === 'callflow') {
        return it.name || (it.numbers && it.numbers[0]) || '(callflow)';
      }

      if (type === 'user' || type === 'userAffiliations') {
        var fn = it.first_name || '';
        var ln = it.last_name || '';
        var full = (fn + ' ' + ln).trim();
        return full || it.email || it.username || it.name || '(user)';
      }

      if (type === 'vmbox') return it.name || it.mailbox || it.label || '(vmbox)';
      return it.name || it.label || it.number || '(object)';
    },

    /* =========================
     * SDK calls (safe)
     * ========================= */

    _callSdk: function (resource, data) {
      var self = this;

      return new Promise(function (resolve, reject) {
        self.callApi({
          resource: resource,
          data: data,
          success: function (resp) {
            resolve(resp && resp.data ? resp.data : resp);
          },
          error: function (err) {
            reject(err);
          }
        });
      });
    },

    _safeList: function (resource, accountId, filters) {
      var self = this;

      if (!resource) return Promise.resolve([]);

      return self._callSdk(resource, {
        accountId: accountId,
        filters: filters || {}
      }).catch(function (err) {
        var msg = String((err && (err.message || err.error || err.responseText)) || '');
        if (msg.indexOf('This api does not exist') >= 0) return [];
        throw err;
      });
    },

    _loadSourceList: function (type) {
      var self = this;

      if (type === 'user' || type === 'userAffiliations') {
        return self._safeList(self.sdk.userList, self.accountId, {
          fields: ['first_name', 'last_name', 'email', 'username', 'id', 'call_failover', 'call_forward', 'caller_id']
        });
      }

      if (type === 'device') {
        return self._safeList(self.sdk.deviceList, self.accountId, {
          fields: ['name', 'owner_id', 'id']
        });
      }

      if (type === 'vmbox') {
        return self._safeList(self.sdk.vmboxList, self.accountId, {
          fields: ['name', 'mailbox', 'owner_id', 'id']
        });
      }

      if (type === 'callflow') {
        return self._safeList(self.sdk.callflowList, self.accountId, {
          fields: ['name', 'id', 'numbers', 'owner_id', 'flow'],
          key_missing: 'featurecode'
        });
      }

      if (type === 'group') {
        return self._safeList(self.sdk.groupList, self.accountId, {
          fields: ['name', 'id']
        });
      }

      if (type === 'faxbox') {
        return self._safeList(self.sdk.faxboxList, self.accountId, {
          fields: ['name', 'id', 'owner_id']
        });
      }

      if (type === 'directory') {
        return self._safeList(self.sdk.directoryList, self.accountId, {
          fields: ['name', 'id']
        });
      }

      return Promise.resolve([]);
    },

    /* =========================
     * Search
     * ========================= */

    _runSearch: function ($layout) {
      var self = this;
      var type = self.state.type;

      var needle;
      if (type === 'email' || type === 'number') needle = $.trim($layout.find('#of-text').val() || '');
      else needle = $layout.find('#of-object-select').val();

      if (!needle) {
        self._updateSearchEnabled($layout);
        return;
      }

      if (type === 'email') needle = needle.toLowerCase();
      if (type === 'number') needle = self._normalizeNumber(needle);

      self._setBusy($layout, true, 'Scanning…');

      self._fetchScanData(type)
        .then(function (payload) {
          var results = self._scanAll(type, needle, payload);
          self._renderResults($layout, results);
        })
        .catch(function (err) {
          monster.ui.alert('error', (err && err.message) ? err.message : 'Search failed');
        })
        .then(function () {
          self._setBusy($layout, false, '');
          self._updateSearchEnabled($layout);
        });
    },

    _addOwnerUserResult: function (out, payload, ownerId) {
      if (!ownerId) return;

      var u = _.find(payload.users || [], function (x) { return String(x.id) === String(ownerId); });
      if (!u) return;

      out.users.push({
        id: u.id,
        name: this._displayName('user', u),
        occurrences: [this._occ('Owner', null, null)]
      });
    },

    _fetchScanData: function () {
      var self = this;

      var tasks = {
        users: function (cb) {
          self._safeList(self.sdk.userList, self.accountId, {
            fields: ['first_name', 'last_name', 'email', 'username', 'id', 'directories', 'call_failover', 'call_forward', 'caller_id']
          }).then(function (d) { cb(null, d || []); }).catch(cb);
        },
        devices: function (cb) {
          self._safeList(self.sdk.deviceList, self.accountId, {
            fields: ['name', 'owner_id', 'id']
          }).then(function (d) { cb(null, d || []); }).catch(cb);
        },
        vmboxes: function (cb) {
          self._safeList(self.sdk.vmboxList, self.accountId, {
            fields: ['name', 'mailbox', 'owner_id', 'id', 'notify_email_addresses']
          }).then(function (d) { cb(null, d || []); }).catch(cb);
        },
        callflows: function (cb) {
          self._safeList(self.sdk.callflowList, self.accountId, {
            fields: ['name', 'id', 'owner_id', 'numbers', 'flow'],
            key_missing: 'featurecode'
          }).then(function (d) { cb(null, d || []); }).catch(cb);
        },
        groups: function (cb) {
          self._safeList(self.sdk.groupList, self.accountId, {
            fields: ['name', 'id', 'owner_id', 'endpoints', 'members', 'users', 'devices']
          }).then(function (d) { cb(null, d || []); }).catch(cb);
        },
        faxboxes: function (cb) {
          self._safeList(self.sdk.faxboxList, self.accountId, {
            fields: ['name', 'id', 'owner_id', 'notifications', 'smtp_permission_list']
          }).then(function (d) { cb(null, d || []); }).catch(cb);
        },
        directories: function (cb) {
          self._safeList(self.sdk.directoryList, self.accountId, {
            fields: ['name', 'id', 'users', 'users.user_id', 'endpoints', 'entries', 'callflows', 'devices']
          }).then(function (d) { cb(null, d || []); }).catch(cb);
        }
      };

      return new Promise(function (resolve, reject) {
        monster.parallel(tasks, function (err, res) {
          if (err) return reject(err);
          resolve(res || {});
        });
      });
    },

    _collectAffiliationMap: function (userId, payload) {
      var self = this;
      var map = {};

      map[String(userId)] = { type: 'user', name: 'User' };

      function safeName(type, obj) {
        return self._displayName(type, obj);
      }

      _.each(payload.devices || [], function (d) {
        var dId = d && (d.id || d._id);
        if (d && String(d.owner_id) === String(userId) && dId) {
          map[String(dId)] = { type: 'Device', name: safeName('device', d) };
        }
      });

      _.each(payload.vmboxes || [], function (v) {
        var vId = v && (v.id || v._id);
        if (v && String(v.owner_id) === String(userId) && vId) {
          map[String(vId)] = { type: 'Voicemail Box', name: safeName('vmbox', v) };
        }
      });

      _.each(payload.faxboxes || [], function (f) {
        var fId = f && (f.id || f._id);
        if (f && String(f.owner_id) === String(userId) && fId) {
          map[String(fId)] = { type: 'Faxbox', name: safeName('faxbox', f) };
        }
      });

      delete map.undefined;
      delete map.null;

      return map;
    },

    _scanAll: function (type, needle, payload) {
      var self = this;

      var out = {
        users: [],
        devices: [],
        vmboxes: [],
        callflows: [],
        groups: [],
        faxboxes: [],
        directories: []
      };

      var idx = self._buildNameIndex(payload);
      var dirRefs = self._collectUserDirectoryRefs(payload);

      var idKindMap = null;
      var needles = [String(needle)];

      if (type === 'userAffiliations') {
        idKindMap = self._collectAffiliationMap(needle, payload);
        needles = _.keys(idKindMap);
      } else {
        idKindMap = null;
        needles = [String(needle)];
      }

      needles = _.uniq(needles);

      function push(tableKey, doc, occurrences) {
        var id = doc.id || doc._id;

        var displayType = self._tableKeyToType(tableKey);
        var name =
          (idx[tableKey] && idx[tableKey][id]) ||
          self._displayName(displayType, doc) ||
          '(object)';

        out[tableKey].push({
          id: id,
          name: name,
          occurrences: self._normOcc(occurrences && occurrences.length ? occurrences : ['Match'])
        });
      }

      function docHasNeedle(doc) {
        var hay = JSON.stringify(doc || {});
        return _.some(needles, function (n) { return hay.indexOf(String(n)) >= 0; });
      }

      _.each(payload.users || [], function (u) {
        if ((type === 'user' || type === 'userAffiliations') && String(u.id) === String(needle)) return;

        if (type === 'email') {
          var email = (u.email || '').toLowerCase();
          var usern = (u.username || '').toLowerCase();
          if (email.indexOf(needle) >= 0) push('users', u, ['Email']);
          else if (usern.indexOf(needle) >= 0) push('users', u, ['Username']);
          return;
        }

        if (type === 'number') {
          if (JSON.stringify(u || {}).indexOf(needle) >= 0) push('users', u, self._toolboxPaths(u, needle, 'users'));
          return;
        }

        if (type === 'callflow') {
          var pths = self._findPaths(u || {}, [String(needle)], 50);
          if (pths.length && _.every(pths, function (p) { return p.indexOf('directories') === 0; })) {
            return;
          }
        }

        if (docHasNeedle(u)) push('users', u, self._toolboxPaths(u, needle, 'users'));
      });

      _.each(payload.devices || [], function (d) {
        if (type === 'device' && String(d.id) === String(needle)) return;

        if ((type === 'user' || type === 'userAffiliations') && d.owner_id === needle) {
          push('devices', d, ['Owned']);
          return;
        }

        if (docHasNeedle(d)) push('devices', d, self._toolboxPaths(d, needle, 'devices'));
      });

      _.each(payload.vmboxes || [], function (v) {
        if (type === 'vmbox' && (String(v.id) === String(needle) || String(v._id) === String(needle))) return;

        if ((type === 'user' || type === 'userAffiliations') && v.owner_id === needle) {
          push('vmboxes', v, ['Owned']);
          return;
        }

        if (docHasNeedle(v)) push('vmboxes', v, self._toolboxPaths(v, needle, 'vmboxes'));
      });

      _.each(payload.faxboxes || [], function (f) {
        if (type === 'faxbox' && String(f.id) === String(needle)) return;

        if ((type === 'user' || type === 'userAffiliations') && f.owner_id === needle) {
          push('faxboxes', f, ['Owned']);
          return;
        }

        if (docHasNeedle(f)) push('faxboxes', f, self._toolboxPaths(f, needle, 'faxboxes'));
      });

      _.each(payload.groups || [], function (g) {
        if (type === 'group' && String(g.id || g._id) === String(needle)) return;

        var labels = [];
        labels = labels.concat(self._matchNeedlesToLabels(g.endpoints, needles, 'Member', idKindMap));

        if (!labels.length) {
          labels = labels.concat(self._matchNeedlesToLabels(g, needles, 'Member', idKindMap));
        }

        if (!labels.length && docHasNeedle(g)) {
          labels = self._toolboxPaths(g, needle, 'groups');
        }

        if (labels.length) push('groups', g, _.uniq(labels));
      });

      // DIRECTORIES usage comes from users[].directories map (dirId -> callflowId)
      if (type === 'directory') {
        _.each(dirRefs, function (ref) {
          if (String(ref.directoryId) !== String(needle)) return;

          var dirName = self._getNameByIdFromIndex(idx.directories, ref.directoryId, '(directory)');
          var cfName = self._getNameByIdFromIndex(idx.callflows, ref.callflowId, '(callflow)');
          var uName = self._getNameByIdFromIndex(idx.users, ref.userId, '(user)');

          push('directories', { id: ref.directoryId, name: dirName }, [
            'Targets callflow: ' + cfName,
            'Via user: ' + uName
          ]);
        });
      } else if (type === 'callflow') {
        _.each(dirRefs, function (ref) {
          if (String(ref.callflowId) !== String(needle)) return;

          var dirName = self._getNameByIdFromIndex(idx.directories, ref.directoryId, '(directory)');
          var uName = self._getNameByIdFromIndex(idx.users, ref.userId, '(user)');

          push('directories', { id: ref.directoryId, name: dirName }, [
            'Targets this callflow',
            'Via user: ' + uName
          ]);
        });
      } else if (type === 'user' || type === 'userAffiliations') {
        _.each(dirRefs, function (ref) {
          if (String(ref.userId) !== String(needle)) return;

          var dirName = self._getNameByIdFromIndex(idx.directories, ref.directoryId, '(directory)');
          var cfName = self._getNameByIdFromIndex(idx.callflows, ref.callflowId, '(callflow)');

          push('directories', { id: ref.directoryId, name: dirName }, [
            'Targets callflow: ' + cfName
          ]);
        });
      } else {
        _.each(payload.directories || [], function (d) {
          if (type === 'directory' && String(d.id || d._id) === String(needle)) return;
          if (docHasNeedle(d)) push('directories', d, self._toolboxPaths(d, needle, 'directories'));
        });
      }

      _.each(payload.callflows || [], function (cf) {
        if (type === 'callflow' && String(cf.id) === String(needle)) return;

        var labels = [];

        if ((type === 'user' || type === 'userAffiliations') && String(cf.owner_id) === String(needle)) {
          labels.push(self._occ('Owned', null, null));
        }

        if (type === 'userAffiliations') {
          _.each(dirRefs, function (ref) {
            if (String(ref.userId) === String(needle) && String(ref.callflowId) === String(cf.id)) {
              var dirName = self._getNameByIdFromIndex(idx.directories, ref.directoryId, '(directory)');
              labels.push(self._occ('Directory Target (Directory: ' + dirName + ')', null, null));
            }
          });
        }

        labels = labels.concat(self._callflowMatchLabels(cf, needles, idKindMap, type));

        labels = _.uniq(labels);
        if (labels.length) push('callflows', cf, labels);
      });

      // Owner lookup for object searches
      if (type === 'device') {
        var dev = _.find(payload.devices || [], function (d) { return String(d.id || d._id) === String(needle); });
        if (dev && dev.owner_id) self._addOwnerUserResult(out, payload, dev.owner_id);
      }
      if (type === 'vmbox') {
        var vb = _.find(payload.vmboxes || [], function (v) { return String(v.id || v._id) === String(needle); });
        if (vb && vb.owner_id) self._addOwnerUserResult(out, payload, vb.owner_id);
      }
      if (type === 'faxbox') {
        var fb = _.find(payload.faxboxes || [], function (f) { return String(f.id || f._id) === String(needle); });
        if (fb && fb.owner_id) self._addOwnerUserResult(out, payload, fb.owner_id);
      }
      if (type === 'callflow') {
        var cf0 = _.find(payload.callflows || [], function (c) { return String(c.id || c._id) === String(needle); });
        if (cf0 && cf0.owner_id) self._addOwnerUserResult(out, payload, cf0.owner_id);
      }
      if (type === 'group') {
        var g0 = _.find(payload.groups || [], function (g) { return String(g.id || g._id) === String(needle); });
        if (g0 && g0.owner_id) self._addOwnerUserResult(out, payload, g0.owner_id);
      }

      function dedupeMerge(rows) {
        var byId = {};
        _.each(rows || [], function (r) {
          var id = String(r.id);
          var occ = r.occurrences || [];
          if (!byId[id]) {
            byId[id] = { id: r.id, name: r.name, occurrences: occ.slice() };
          } else {
            byId[id].occurrences = byId[id].occurrences.concat(occ);
            byId[id].occurrences = _.uniqBy(byId[id].occurrences, function (o) {
              return (o.found || '') + '|' + (o.where || '');
            });
          }
        });
        return _.values(byId);
      }

      _.each(_.keys(out), function (k) {
        out[k] = dedupeMerge(out[k]);
        out[k] = _.sortBy(out[k], function (r) { return (r.name || '').toLowerCase(); });
      });

      // Callflows: owned first, then name
      out.callflows = _.sortBy(out.callflows, [
        function (r) {
          return _.some(r.occurrences || [], function (o) {
            return String(o.where || '').toLowerCase() === 'owned';
          }) ? 0 : 1;
        },
        function (r) { return (r.name || '').toLowerCase(); }
      ]);

      return out;
    },

    _buildNameIndex: function (payload) {
      var self = this;

      function index(list, type) {
        var m = {};
        _.each(list || [], function (it) {
          var id = it.id || it._id;
          m[id] = self._displayName(type, it);
        });
        return m;
      }

      return {
        users: index(payload.users, 'user'),
        devices: index(payload.devices, 'device'),
        vmboxes: index(payload.vmboxes, 'vmbox'),
        callflows: index(payload.callflows, 'callflow'),
        groups: index(payload.groups, 'group'),
        faxboxes: index(payload.faxboxes, 'faxbox'),
        directories: index(payload.directories, 'directory')
      };
    },

    _collectUserDirectoryRefs: function (payload) {
      var refs = [];
      _.each(payload.users || [], function (u) {
        var dirs = u && u.directories;
        if (!dirs || !_.isObject(dirs)) return;

        _.each(dirs, function (callflowId, directoryId) {
          if (!directoryId || !callflowId) return;
          refs.push({
            userId: String(u.id),
            directoryId: String(directoryId),
            callflowId: String(callflowId)
          });
        });
      });
      return refs;
    },

    _getNameByIdFromIndex: function (idxMap, id, fallback) {
      return (idxMap && idxMap[id]) || fallback || id;
    },

    _callflowMatchLabels: function (callflow, needles, idKindMap, searchType) {
      var self = this;
      var labels = [];

      if (searchType === 'number' && _.isArray(callflow.numbers)) {
        _.each(callflow.numbers, function (n) {
          var sNorm = self._normalizeNumber(String(n));
          _.each(needles, function (nd) {
            var ndNorm = self._normalizeNumber(String(nd));
            if (ndNorm && sNorm && sNorm.indexOf(ndNorm) >= 0) {
              labels.push(self._occ('Number', null, null));
            }
          });
        });
      }

      if (callflow.flow) {
        labels = labels.concat(self._flowBreadcrumbHits(callflow.flow, needles, idKindMap));
      }

      return labels;
    },

    _toolboxPaths: function (doc, needle, docType) {
      var self = this;
      var paths = self._findPaths(doc, [String(needle)], 10);

      return _.uniq(_.map(paths, function (p) {
        if (p.indexOf('owner_id') >= 0) return 'Owned';

        if (p.indexOf('members') >= 0 || p.indexOf('endpoints') >= 0 || p.indexOf('users') >= 0 || p.indexOf('devices') >= 0) {
          return 'Member';
        }

        if (docType === 'users') {
          if (p.indexOf('call_forward.number') === 0) {
            var enFwd = _.get(doc, 'call_forward.enabled');
            return 'Call Forward Number ' + (enFwd === false ? '(Disabled)' : '(Enabled)');
          }
          if (p.indexOf('call_failover.number') === 0) {
            var enFail = _.get(doc, 'call_failover.enabled');
            return 'Call Failover Number ' + (enFail === false ? '(Disabled)' : '(Enabled)');
          }
        }

        return self._prettyPath(p, docType);
      }));
    },

    _matchNeedlesToLabels: function (obj, needles, baseLabel, idKindMap) {
      var self = this;
      var hay = JSON.stringify(obj || {});
      var labels = [];

      _.each(needles || [], function (n) {
        if (hay.indexOf(String(n)) >= 0) {
          labels.push(baseLabel + self._kindSuffix(n, idKindMap));
        }
      });

      return _.uniq(labels);
    },

    _findPaths: function (obj, needles, maxPaths) {
      var paths = [];
      needles = _.map(needles || [], function (n) { return String(n); });

      function walk(v, p, depth) {
        if (paths.length >= maxPaths) return;
        if (depth > 12) return;

        if (_.isString(v) || _.isNumber(v) || _.isBoolean(v)) {
          var s = String(v);
          if (_.some(needles, function (n) { return s.indexOf(n) >= 0; })) {
            paths.push(p || '(root)');
          }
          return;
        }

        if (_.isArray(v)) {
          _.each(v, function (child, idx) {
            walk(child, p ? (p + '[' + idx + ']') : ('[' + idx + ']'), depth + 1);
          });
          return;
        }

        if (_.isObject(v)) {
          _.each(v, function (child, key) {
            walk(child, p ? (p + '.' + key) : key, depth + 1);
          });
        }
      }

      walk(obj, '', 0);
      return _.uniq(paths).slice(0, maxPaths);
    },

    _renderResults: function ($layout, results) {
      function prepRows(rows) {
        rows = rows || [];

        rows = _.filter(rows, function (r) {
          return r && _.isArray(r.occurrences) && r.occurrences.length > 0;
        });

        _.each(rows, function (r) {
          r.rowSpan = (r.occurrences && r.occurrences.length) ? r.occurrences.length : 1;
          _.each(r.occurrences, function (o, idx) {
            o.isFirst = (idx === 0);
          });
        });

        return rows;
      }

      function table(title, rows) {
        rows = prepRows(rows);

        var showFound = _.some(rows, function (r) {
          return _.some(r.occurrences || [], function (o) {
            return o && o.found && String(o.found).trim().length > 0;
          });
        });

        return { title: title, rows: rows, showFound: showFound, colSpan: showFound ? 3 : 2 };
      }

      var tables = [
        table('Users', results.users),
        table('Devices', results.devices),
        table('Voicemail Boxes', results.vmboxes),
        table('Callflows', results.callflows),
        table('Groups', results.groups),
        table('Faxboxes', results.faxboxes),
        table('Directories', results.directories)
      ];

      var hasAny = _.some(tables, function (t) { return t.rows && t.rows.length; });

      var $results = $(this.getTemplate({
        name: 'results',
        data: { hasAny: hasAny, tables: tables }
      }));

      $layout.find('#of-results').empty().append($results);
    },

    _normalizeNumber: function (v) {
      return String(v || '').replace(/\D/g, '');
    }
  };

  return app;
});
