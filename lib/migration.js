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
        operations.push('ADD COLUMN ' + self.columnEscaped(model, propName) +
        ' ' + self.buildColumnDefinition(model, propName));
      }
    });

    function actualize(propName, oldSettings) {
      var newSettings = m.properties[propName];
      if (newSettings && changed(newSettings, oldSettings)) {
        // TODO: NO TESTS EXECUTE THIS CODE PATH
        operations.push('CHANGE COLUMN ' + self.columnEscaped(model, propName) +
        ' ' + self.columnEscaped(model, propName) + ' ' +
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
          operations.push('DROP COLUMN ' + self.columnEscaped(model, f.NAME));
        }
      });
    }
    return operations;
  };

  IBMDB.prototype.dropIndexes = function(model, actualIndexes) {
    var self = this;
    var operations = [];

    // If there are indexes for this table then we need to drop them.
    // Generate the statements here to drop all known indexes.
    if (actualIndexes) {
      actualIndexes.forEach(function(i) {
        var isPrimaryIndex = i.UNIQUERULE === 'P';
        var stmt;
        if (isPrimaryIndex) {
          stmt = 'ALTER TABLE ' + self.schema + '.' +
              self.tableEscaped(model) + ' ' + 'DROP PRIMARY KEY';
        } else {
          stmt = 'DROP INDEX "' + i.INDNAME + '"';
        }
        operations.push(stmt);
      });
    }

    return operations;
  };

  IBMDB.prototype.alterTable = function(model, actualFields, actualIndexes,
    callback, checkOnly) {
    debug('IBMDB.prototype.alterTable %j %j %j %j',
      model, actualFields, actualIndexes, checkOnly);
    var self = this;
    var sql = [];
    var tasks = [];
    var pks = this.idNames(model).map(function(i) {
      return self.columnEscaped(model, i);
    });

    // Create the statements to drop all existing indexes before we start
    // altering the table.
    sql = sql.concat(self.dropIndexes(model, actualIndexes));

    // Add/Modify and drop column statements for ALTER TABLE are generated
    // prior to re-building the indexes as defined in the model.
    var operations = self.getAddModifyColumns(model, actualFields);
    operations = operations.concat(self.getDropColumns(model, actualFields));

    if (operations.length) {
      // Add the ALTER TABLE statement to the list of tasks to perform later.
      sql.push('ALTER TABLE ' + self.schema + '.' +
              self.tableEscaped(model) + ' ' + operations.join(' ') + ';');
    }

    // Now that the column altering statments have been added we can add in the
    // indexes again.
    // ------------------------------------------------------------------------
    sql = sql.concat(self.buildIndexes(model));

    // add back the primary key index
    async.forEach(pks, function(pk) {
      sql.push('ALTER TABLE ' + self.schema + '.' +
        self.tableEscaped(model) + ' ' + 'ADD PRIMARY KEY (' +
        pk + ')');
    });

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
