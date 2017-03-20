// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

var async = require('async');
var debug = require('debug')('loopback:ibmdb');

module.exports = function(IBMDB) {
  IBMDB.prototype.showFields = function(model, cb) {
    var self = this;
    var sql = 'SELECT COLNAME AS NAME, TYPENAME AS DATATYPE, ' +
    'COLNO, LENGTH AS DATALENGTH, NULLS FROM SYSCAT.COLUMNS ' +
    'WHERE TRIM(TABNAME) LIKE \'' +
    self.table(model) + '\' ' +
    'AND TRIM(TABSCHEMA) LIKE \'' +
    self.schema + '\'' +
    ' ORDER BY COLNO';
    this.execute(sql, function(err, fields) {
      if (err) {
        return cb(err);
      } else {
        cb(err, fields);
      }
    });
  };

  IBMDB.prototype.showIndexes = function(model, cb) {
    var self = this;
    var sql = 'SELECT TABNAME, TABSCHEMA, INDNAME, ' +
    'COLNAMES, UNIQUERULE FROM SYSCAT.INDEXES ' +
    'WHERE TRIM(TABNAME) LIKE \'' +
    self.table(model) + '\' ' +
    'AND TRIM(TABSCHEMA) LIKE \'' +
    self.schema + '\'';
    this.execute(sql, function(err, indexes) {
      if (err) {
        return cb(err);
      } else {
        cb(err, indexes);
      }
    });
  };

  IBMDB.prototype.getColumnsToAdd = function(model, actualFields) {
    var self = this;
    var m = self._models[model];
    var propNames = Object.keys(m.properties).filter(function(name) {
      return !!m.properties[name];
    });

    var operations = [];

    // change/add new fields
    propNames.forEach(function(propName) {
      if (m.properties[propName] && self.id(model, propName)) return;
      var found;
      if (actualFields) {
        actualFields.forEach(function(f) {
          if (f.NAME === propName) {
            found = f;
          }
        });
      }

      if (found) {
        actualize(propName, found);
      } else {
        operations.push('ADD COLUMN ' + propName + ' ' +
        self.buildColumnDefinition(model, propName));
      }
    });

    function actualize(propName, oldSettings) {
      var newSettings = m.properties[propName];
      if (newSettings && changed(newSettings, oldSettings)) {
        // TODO: NO TESTS EXECUTE THIS CODE PATH
        var pName = '\'' + propName + '\'';
        operations.push('CHANGE COLUMN ' + pName + ' ' + pName + ' ' +
        self.buildColumnDefinition(model, propName));
      }
    }

    function changed(newSettings, oldSettings) {
      if (oldSettings.Null === 'YES') {
        // Used to allow null and does not now.
        if (!self.isNullable(newSettings)) {
          return true;
        }
      }
      if (oldSettings.Null === 'NO') {
        // Did not allow null and now does.
        if (self.isNullable(newSettings)) {
          return true;
        }
      }
      return false;
    }
    return operations;
  };

  IBMDB.prototype.getColumnsToDrop = function(model, actualFields) {
    var self = this;
    var m = this._models[model];
    var propNames = Object.keys(m.properties).filter(function(name) {
      return !!m.properties[name];
    });

    var operations = [];

    // drop columns
    if (actualFields) {
      actualFields.forEach(function(f) {
        var notFound = !~propNames.indexOf(f.NAME);
        if (m.properties[f.NAME] && self.id(model, f.NAME)) return;
        if (notFound || !m.properties[f.NAME]) {
          operations.push('DROP COLUMN ' + f.NAME);
        }
      });
    }
    return operations;
  };

  IBMDB.prototype.addIndexes = function(model, actualIndexes) {
    var ai = {};
    var self = this;
    var m = this.getModelDefinition(model);
    var indexes = m.settings.indexes || {};
    var indexNames = Object.keys(indexes).filter(function(name) {
      return !!m.settings.indexes[name];
    });
    var operations = [];
    var propNames = Object.keys(m.properties).filter(function(name) {
      return !!m.properties[name];
    });
    var sql = [];
    var type = '';

    if (actualIndexes) {
      actualIndexes.forEach(function(i) {
        var name = i.INDNAME;
        if (!ai[name]) {
          ai[name] = {
            info: i,
            columns: [],
          };
        }

        i.COLNAMES.split(/\+\s*/).forEach(function(columnName, j) {
          // This is a bit of a dirty way to get around this but DB2 returns
          // column names as a string started with and separated by a '+'.
          // The code below will strip out the initial '+' then store the
          // actual column names.
          if (j > 0)
            ai[name].columns[j - 1] = columnName;
        });
      });
    }
    var aiNames = Object.keys(ai);
    // remove indexes
    aiNames.forEach(function(indexName) {
      if (ai[indexName].info.UNIQUERULE === 'P' || // indexName === 'PRIMARY' ||
        (m.properties[indexName] && self.id(model, indexName))) return;

      if (indexNames.indexOf(indexName) === -1 && !m.properties[indexName] ||
      m.properties[indexName] && !m.properties[indexName].index) {
        if (ai[indexName].info.UNIQUERULE === 'P') {
          operations.push('DROP PRIMARY KEY');
        } else if (ai[indexName].info.UNIQUERULE === 'U') {
          operations.push('DROP UNIQUE ' + indexName);
        }
      } else {
        // first: check single (only type and kind)
        if (m.properties[indexName] && !m.properties[indexName].index) {
          // TODO
          return;
        }
        // second: check multiple indexes
        var orderMatched = true;
        if (indexNames.indexOf(indexName) !== -1) {
          m.settings.indexes[indexName].columns.split(/,\s*/).forEach(
          function(columnName, i) {
            if (ai[indexName].columns[i] !== columnName)
              orderMatched = false;
          });
        }

        if (!orderMatched) {
          if (ai[indexName].info.UNIQUERULE === 'P') {
            operations.push('DROP PRIMARY KEY');
          } else if (ai[indexName].info.UNIQUERULE === 'U') {
            operations.push('DROP UNIQUE ' + indexName);
          }

          delete ai[indexName];
        }
      }
    });

    if (operations.length) {
      // Add the ALTER TABLE statement to the list of tasks to perform later.
      sql.push('ALTER TABLE ' + self.schema + '.' +
              self.tableEscaped(model) + ' ' + operations.join(' ') + ';');
    }

    // add single-column indexes
    propNames.forEach(function(propName) {
      var i = m.properties[propName].index;
      if (!i) {
        return;
      }
      var found = ai[propName] && ai[propName].info;
      if (!found) {
        var pName = propName;
        type = '';
        if (i.type) {
          type = i.type;
        }
        sql.push('CREATE ' + type + ' INDEX ' + pName + ' ON ' +
        self.schema + '.' + self.tableEscaped(model) +
        '(\"' + pName + '\") ');
      }
    });

    // add multi-column indexes
    indexNames.forEach(function(indexName) {
      var i = m.settings.indexes[indexName];
      var found = ai[indexName] && ai[indexName].info;
      if (!found) {
        var iName = indexName;
        var type = '';
        if (i.type) {
          type = i.type;
        }
        var stmt = 'CREATE ' + type + 'INDEX ' + iName + ' ON ' +
        self.schema + '.' + self.tableEscaped(model) + '(';

        var splitNames = i.columns.split(/,\s*/);
        var colNames = splitNames.join('\",\"');

        stmt += '\"' + colNames + '\")';

        sql.push(stmt);
      }
    });
    return sql;
  };

  IBMDB.prototype.alterTable = function(model, actualFields, actualIndexes,
  callback, checkOnly) {
    debug('IBMDB.prototype.alterTable %j %j %j %j',
           model, actualFields, actualIndexes, checkOnly);
    var self = this;
    var sql = [];
    var tasks = [];

    var operations = self.getAddModifyColumns(model, actualFields);
    operations = operations.concat(self.getDropColumns(model, actualFields));

    if (operations.length) {
      // Add the ALTER TABLE statement to the list of tasks to perform later.
      sql.push('ALTER TABLE ' + self.schema + '.' +
              self.tableEscaped(model) + ' ' + operations.join(' ') + ';');
    }
    sql = sql.concat(self.addIndexes(model, actualIndexes));

    sql.forEach(function(i) {
      tasks.push(function(cb) {
        self.execute(i, function(err, results) {
          cb(err);
        });
      });
    });

    if (tasks.length) {
      if (checkOnly) {
        return (callback(null, true, {statements: sql}));
      } else {
        async.series(tasks, function() {
          return (callback());
        });
      }
    } else {
      return (callback());
    }
  };
};
