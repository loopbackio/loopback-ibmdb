// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-connector-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

var g = require('./globalize');

/*!
 * Common connector infrastructure for IBM database connectors.
 */
var SQLConnector = require('loopback-connector').SQLConnector;
var Driver = require('ibm_db');
var util = require('util');
var debug = require('debug')('loopback:connector:ibmdb');
var async = require('async');

var ParameterizedSQL = IBMDB.ParameterizedSQL = SQLConnector.ParameterizedSQL;
var Transaction = IBMDB.Transaction = SQLConnector.Transaction;

// The generic placeholder
var PLACEHOLDER = SQLConnector.PLACEHOLDER = ParameterizedSQL.PLACEHOLDER;

/**
 * Initialize the IBMDB connector for the given data source
 *
 * @param {DataSource} ds The data source instance
 * @param {Function} [cb] The cb function
 */
exports.initialize = function(ds, cb) {
  ds.connector = new IBMDB('IBMDB', ds.settings);
  ds.connector.dataSource = ds;
  cb();
};

module.exports = IBMDB;

/**
 * The constructor for the IBMDB LoopBack connector
 *
 * @param {string} name The name of the connector
 * @param {Object} settings The settings object
 * @constructor
 */
function IBMDB(name, settings) {
  SQLConnector.call(this, name, settings);

  // Create the Connection Pool object.  It will be initialized once we
  // have the connection string prepped below.
  this.setConnectionProperties(name, settings);
  this.client = new Driver.Pool(this.connectionOptions);
  this.client.init(this.connectionOptions.minPoolSize, this.connStr);
};

util.inherits(IBMDB, SQLConnector);

IBMDB.prototype.setConnectionProperties = function(name, settings) {
  var self = this;
  self.dbname = (settings.database || settings.db || 'testdb');
  self.dsn = settings.dsn;
  self.hostname = (settings.hostname || settings.host);
  self.username = (settings.username || settings.user);
  self.password = settings.password;
  self.portnumber = settings.port;
  self.protocol = (settings.protocol || 'TCPIP');

  // Save off the connectionOptions passed in for connection pooling
  self.connectionOptions = {};
  self.connectionOptions.minPoolSize = parseInt(settings.minPoolSize, 10) || 0;
  self.connectionOptions.maxPoolSize = parseInt(settings.maxPoolSize, 10) || 0;
  self.connectionOptions.connectionTimeout =
    parseInt(settings.connectionTimeout, 10) || 60;

  var dsn = settings.dsn;
  if (dsn) {
    self.connStr = dsn;

    var DSNObject = self.parseDSN(dsn);
    if (!('CurrentSchema' in DSNObject)) {
      self.connStr += ';CurrentSchema=' + DSNObject.UID;
    }
    self.schema = DSNObject.CurrentSchema || DSNObject.UID;
  } else {
    var connStrGenerate =
      'DRIVER={' + name + '}' +
      ';DATABASE=' + this.dbname +
      ';HOSTNAME=' + this.hostname +
      ';UID=' + this.username +
      ';PWD=' + this.password +
      ';PORT=' + this.portnumber +
      ';PROTOCOL=' + this.protocol;
    self.connStr = connStrGenerate;

    self.schema = this.username;
    if (settings.schema) {
      self.schema = settings.schema.toUpperCase();
    }

    self.connStr += ';CurrentSchema=' + self.schema;
  }
};

IBMDB.prototype.parseDSN = function(dsn) {
  // Split dsn into an array of optionStr
  var dsnOption = dsn.split(';');
  // Handle dsn string ended with ';'
  if (!dsnOption[dsnOption.length - 1]) {
    dsnOption.pop();
  }

  // Convert Array<String> into Object
  var result = {};
  dsnOption.forEach(function(str) {
    var strSplit = str.split('=');
    result[strSplit[0]] = strSplit[1];
  });

  return result;
};

IBMDB.prototype.tableEscaped = function(model) {
  var escapedName = this.escapeName(this.table(model));
  return escapedName;
};

IBMDB.prototype.ping = function(cb) {
  debug('IBM.prototype.ping');
  var self = this;
  var sql = 'SELECT COUNT(*) AS COUNT FROM SYSIBM.SYSDUMMY1';

  if (self.dataSource.connection) {
    ping(self.dataSource.connection, cb);
  } else {
    self.connect(function(err, conn) {
      if (err) {
        return cb(err);
      }
      ping(conn, function(err, res) {
        conn.close(function(cerr) {
          if (err || cerr) {
            return cb(err || cerr);
          }
          return cb(null, res);
        });
      });
    });
  }

  function ping(conn, cb) {
    conn.query(sql, function(err, rows) {
      if (err) {
        return cb(err);
      }
      cb(null, rows.length > 0 && rows[0]['COUNT'] > 0);
    });
  }
};

IBMDB.prototype.testConnection = function(conn, sql) {
  var rows = conn.querySync(sql, null);

  debug('IBMDB.prototype.testConnection: sql=%j, rows=%j', sql, rows);

  if (rows.length > 0 && rows[0]['COUNT'] > 0) {
    return true;
  } else {
    return false;
  }
};

/**
 * Connect to IBM database.
 *
 * {Function} [cb] The callback after the connect
 */
IBMDB.prototype.connect = function(cb) {
  var self = this;

  if (!self.dsn && (!self.hostname ||
      !self.portnumber ||
      !self.username ||
      !self.password ||
      !self.protocol)) {
    g.log('Invalid connection string: %s', self.connStr);
    return (cb && cb());
  }

  self.dataSource.connecting = true;
  self.client.open(this.connStr, function(err, con) {
    if (err) {
      self.dataSource.connected = false;
      self.dataSource.connecting = false;
    } else {
      self.dataSource.connected = true;
      self.dataSource.connecting = false;
      self.dataSource.emit('connected');
    }
    return cb && cb(err, con);
  });
};

/**
 * Escape an identifier such as the column name
 * IBMDB requires double quotes for case-sensitivity
 *
 * @param {string} name A database identifier
 * @returns {string} The escaped database identifier
 */
IBMDB.prototype.escapeName = function(name) {
  debug('IBMDB.prototype.escapeName name=%j', name);
  if (!name) return name;
  name.replace(/["]/g, '""');
  return '"' + name + '"';
};

/**
 * Execute the sql statement
 *
 */
IBMDB.prototype.executeSQL = function(sql, params, options, callback) {
  debug('IBMDB.prototype.executeSQL (enter)',
    sql, params, options);

  var self = this;

  function executeStatement(conn, cb) {
    var limit = 0;
    var offset = 0;
    var stmt = {};

    stmt.noResults = options && options.noResultSet ?
      options.noResultSet : false;

    // This is standard DB2 syntax. LIMIT and OFFSET
    // are configured off by default. Enable these to
    // leverage LIMIT and OFFSET.
    if (!self.useLimitOffset) {
      var res = sql.match(self.limitRE);
      if (res) {
        limit = parseInt(res[1], 10);
        sql = sql.replace(self.limitRE, '');
      }
      res = sql.match(self.offsetRE);
      if (res) {
        offset = parseInt(res[1], 10);
        sql = sql.replace(self.offsetRE, '');
      }
    }

    // Build the stmt object that will be passed into the query call.
    // This is done because the query call can take an object or a set
    // of parameters.  Depending on the SQL being passed in the call with
    // parameters may fail due to improper handling in the ibm_db module.
    stmt.sql = sql;
    stmt.params = params;

    conn.query(stmt, function(err, data, more) {
      debug('IBMDB.prototype.executeSQL (exit)' +
      ' stmt=%j params=%j err=%j data=%j more=%j',
      stmt, params, err, data, more);
      // schedule callback as there is more code to
      // execute in the db2 driver to cleanup the current query
      if (offset || limit) {
        data = data.slice(offset, offset + limit);
      }

      if (!err) {
        if (more) {
          process.nextTick(function() {
            return cb(err, data);
          });
        }
      }

      return cb && cb(err, data);
    });
  };

  if (options.transaction) {
    var conn = options.transaction.connection;
    executeStatement(conn, function(err, data) { callback(err, data); });
  } else {
    this.connect(function(err, conn) {
      if (err) return callback(err);

      executeStatement(conn, function(err, data) {
        conn.close(function() {
          callback(err, data);
        });
      });
    });
  }
};

function dateToIBMDB(val) {
  var dateStr = val.getFullYear() + '-' +
      fillZeros(val.getMonth() + 1) + '-' +
      fillZeros(val.getDate()) + '-' +
      fillZeros(val.getHours()) + '.' +
      fillZeros(val.getMinutes()) + '.' +
      fillZeros(val.getSeconds()) + '.';
  var ms = val.getMilliseconds();
  if (ms < 10) {
    ms = '00000' + ms;
  } else if (ms < 100) {
    ms = '0000' + ms;
  } else {
    ms = '000' + ms;
  }
  return dateStr + ms;
  function fillZeros(v) {
    return v < 10 ? '0' + v : v;
  }
};

/**
 * Convert property name/value to an escaped DB column value
 *
 * @param {Object} prop Property descriptor
 * @param {*} val Property value
 * @returns {*} The escaped value of DB column
 */
IBMDB.prototype.toColumnValue = function(prop, val) {
  debug('IBMDB.prototype.toColumnValue prop=%j val=%j', prop, val);
  if (val == null) {
    if (prop.autoIncrement || prop.id) {
      return new ParameterizedSQL('DEFAULT');
    }
    return null;
  }
  if (!prop) {
    return val;
  }
  switch (prop.type.name) {
    default:
    case 'Array':
    case 'Number':
    case 'String':
      return val;
    case 'Boolean':
      return Number(val);
    case 'GeoPoint':
    case 'Point':
    case 'List':
    case 'Object':
    case 'ModelConstructor':
      return JSON.stringify(val);
    case 'JSON':
      return String(val);
    case 'Date':
      return dateToIBMDB(val);
  }
};

/*!
 * Convert the data from database column to model property
 *
 * @param {object} Model property descriptor
 * @param {*) val Column value
 * @returns {*} Model property value
 */
IBMDB.prototype.fromColumnValue = function(prop, val) {
  debug('IBMDB.prototype.fromColumnValue %j %j', prop, val);
  if (val === undefined || val === null || !prop) {
    return val;
  }
  switch (prop.type.name) {
    case 'Number':
      return Number(val);
    case 'String':
      return String(val);
    case 'Date':
      return new Date(val);
    case 'Boolean':
      return Boolean(val);
    case 'GeoPoint':
    case 'Point':
    case 'List':
    case 'Array':
    case 'Object':
    case 'JSON':
      return JSON.parse(val);
    default:
      return val;
  }
};

/**
 * Get the place holder in SQL for identifiers, such as ??
 *
 * @param {string} key Optional key, such as 1 or id
 */
IBMDB.prototype.getPlaceholderForIdentifier = function(key) {
  throw new Error(g.f('Placeholder for identifiers is not supported: %s',
    key));
};

/**
 * Get the place holder in SQL for values, such as :1 or ?
 *
 * @param {string} key Optional key, such as 1 or id
 * @returns {string} The place holder
 */
IBMDB.prototype.getPlaceholderForValue = function(key) {
  debug('IBMDB.prototype.getPlaceholderForValue key=%j', key);
  return '(?)';
};

/**
 * Build the clause for default values if the fields is empty
 *
 * @param {string} model The model name
 * @returns {string} default values statement
 */
IBMDB.prototype.buildInsertDefaultValues = function(model) {
  debug('IBMDB.prototype.buildInsertDefaultValues');
  var def = this.getModelDefinition(model);
  var num = Object.keys(def.properties).length;
  var result = '';
  if (num > 0) result = 'DEFAULT';
  for (var i = 1; i < num && num > 1; i++) {
    result = result.concat(',DEFAULT');
  }
  return 'VALUES(' + result + ')';
};

/**
 * Update if the model instance exists with the same id or create a new instance
 *
 * @param {string} model The model name
 * @param {Object} data The model instance data
 * @param {Function} [callback] The callback function
 */
IBMDB.prototype.updateOrCreate = IBMDB.prototype.save =
  function(model, data, options, callback) {
    debug('IBMDB.prototype.updateOrCreate (enter): model=%j, data=%j, ' +
          'options=%j ', model, data, options);
    var self = this;
    var idName = self.idName(model);
    var stmt;
    var tableName = self.tableEscaped(model);
    var meta = {};

    function executeWithConnection(connection, cb) {
      // Execution for updateOrCreate requires running two
      // separate SQL statements.  The second depends on the
      // result of the first.
      var where = {};
      where[idName] = data[idName];

      var countStmt = new ParameterizedSQL('SELECT COUNT(*) AS CNT FROM ');
      countStmt.merge(tableName);
      countStmt.merge(self.buildWhere(model, where));
      countStmt.noResults = false;

      connection.query(countStmt, function(err, countData) {
        debug('IBMDB.prototype.updateOrCreate (data): err=%j, countData=%j\n',
          err, countData);

        if (err) return cb(err);

        if (countData[0]['CNT'] > 0) {
          stmt = self.buildUpdate(model, where, data);
        } else {
          stmt = self.buildInsert(model, data);
        }

        stmt.noResults = true;

        connection.query(stmt, function(err, sData) {
          debug('IBMDB.prototype.updateOrCreate (data): err=%j, sData=%j\n',
            err, sData);

          if (err) return cb(err);

          meta.isNewInstance = countData[0]['CNT'] === 0;
          cb(null, data, meta);
        });
      });
    };

    if (options.transaction) {
      executeWithConnection(options.transaction.connection,
        function(err, data, meta) {
          if (err) {
            return callback && callback(err);
          } else {
            return callback && callback(null, data, meta);
          }
        });
    } else {
      self.beginTransaction(Transaction.READ_COMMITTED, function(err, conn) {
        if (err) {
          conn.close(function() {});
          return callback && callback(err);
        }
        executeWithConnection(conn, function(err, data, meta) {
          if (err) {
            conn.rollbackTransaction(function() {
              conn.close(function() {});
              return callback && callback(err);
            });
          } else {
            options.transaction = undefined;
            conn.commitTransaction(function(err) {
              conn.close(function() {});

              if (err) {
                return callback && callback(err);
              }

              return callback && callback(null, data, meta);
            });
          }
        });
      });
    }
  };

/**
 * Replace if the model instance exists with the same id
 * or create a new instance
 *
 * @param {string} model The model name
 * @param {Object} where clause
 * @param {Object} data The model instance data
 * @param {Object} options for this call
 * @param {Function} [callback] The callback function
 */
IBMDB.prototype._replace = function(model, where, data, options, callback) {
  debug('IBMDB.prototype._replace (enter): model=%j, data=%j, ' +
        'options=%j\n', model, data, options);
  var self = this;
  var idName = self.idName(model);
  var stmt;
  var tableName = self.tableEscaped(model);
  var meta = {};

  function executeWithConnection(connection, cb) {
    // Execution for _replace requires running 3
    // separate SQL statements. The last depends on the
    // result of the first couple.

    var selectStmt = new ParameterizedSQL('SELECT ' + self.escapeName(idName) +
                                          ' FROM ');
    selectStmt.merge(tableName);
    selectStmt.merge(self.buildWhere(model, where));
    selectStmt.noResults = false;

    connection.query(selectStmt, function(err, selectData) {
      debug('IBMDB.prototype._replace stmt: %j data: %j err: %j\n',
        selectStmt, selectData, err);
      if (err) return cb(err);

      if (selectData.length > 0) {
        // remove existing to replace with a new insert
        stmt = self.buildDelete(model, where);
        stmt.noResults = true;
        connection.query(stmt, function(err, res) {
          debug('IBMDB.prototype._replace stmt: %j data: %j err=%j\n',
            stmt, res, err);

          if (err) return cb(err);

          data[idName] = selectData[0][idName];
          stmt = self.buildInsert(model, data);

          connection.query(stmt, function(err, sData) {
            debug('IBMDB.prototype._replace stmt: %j data: %j err=%j\n',
              stmt, sData, err);
            if (err) return cb(err);

            meta.isNewInstance = (selectData.length > 0);
            cb(null, data, meta);
          });
        });
      } else {
        return cb(errorIdNotFoundForReplace(where.id));
      }
    });
  };

  if (options.transaction) {
    executeWithConnection(options.transaction.connection,
      function(err, data, meta) {
        if (err) {
          return callback && callback(err);
        } else {
          return callback && callback(null, data, meta);
        }
      });
  } else {
    self.beginTransaction(Transaction.READ_COMMITTED, function(err, conn) {
      if (err) {
        return callback && callback(err);
      }
      executeWithConnection(conn, function(err, data, meta) {
        if (err) {
          conn.rollbackTransaction(function() {
            conn.close(function() {});
            return callback && callback(err);
          });
        } else {
          options.transaction = undefined;
          conn.commitTransaction(function(err) {
            if (err) {
              return callback && callback(err);
            }

            conn.close(function() {});
            return callback && callback(null, data, meta);
          });
        }
      });
    });
  }
};

/**
 * Replace if the model instance exists with the same id
 * or create a new instance
 *
 * @param {string} model The model name
 * @param {Object} data The model instance data
 * @param {Object} options for this function call
 * @param {Function} [callback] The callback function
 */
IBMDB.prototype.replaceOrCreate = function(model, data, options, callback) {
  debug('IBMDB.prototype.replaceOrCreate (enter): model=%j, data=%j, ' +
        'options=%j\n', model, data, options);
  var self = this;
  var idName = self.idName(model);
  var stmt;
  var tableName = self.tableEscaped(model);
  var meta = {};

  function executeWithConnection(connection, cb) {
    // Execution for replaceOrCreate requires running 3
    // separate SQL statements. The last depends on the
    // result of the first couple.
    var where = {};
    where[idName] = data[idName];

    var selectStmt = new ParameterizedSQL('SELECT ' + self.escapeName(idName) +
                                          ' FROM ');
    selectStmt.merge(tableName);
    selectStmt.merge(self.buildWhere(model, where));
    selectStmt.noResults = false;

    connection.query(selectStmt, function(err, selectData) {
      debug('IBMDB.prototype.replaceOrCreate stmt: %j data: %j err: %j\n',
        selectStmt, selectData, err);
      if (err) return cb(err);

      if (selectData.length > 0) {
        // remove existing to replace with a new insert
        stmt = self.buildDelete(model, where);
        stmt.noResults = true;
        connection.query(stmt, function(err, res) {
          debug('IBMDB.prototype.replaceOrCreate stmt: %j data: %j err=%j\n',
            stmt, res, err);

          if (err) return cb(err);

          stmt = self.buildInsert(model, data);

          connection.query(stmt, function(err, sData) {
            debug('IBMDB.prototype.replaceOrCreate stmt: %j data: %j err=%j\n',
              stmt, sData, err);
            if (err) return cb(err);

            meta.isNewInstance = (selectData.length === 0);
            cb(null, data, meta);
          });
        });
      } else {
        stmt = self.buildInsert(model, data);
        stmt.noResults = true;

        connection.query(stmt, function(err, sData) {
          debug('IBMDB.prototype.replaceOrCreate stmt: %j data: %j err=%j\n',
            stmt, sData, err);
          if (err) return cb(err);

          meta.isNewInstance = (selectData.length === 0);
          cb(null, data, meta);
        });
      }
    });
  };

  if (options.transaction) {
    executeWithConnection(options.transaction.connection,
      function(err, data, meta) {
        if (err) {
          return callback && callback(err);
        } else {
          return callback && callback(null, data, meta);
        }
      });
  } else {
    self.beginTransaction(Transaction.READ_COMMITTED, function(err, conn) {
      if (err) {
        return callback && callback(err);
      }
      executeWithConnection(conn, function(err, data, meta) {
        if (err) {
          conn.rollbackTransaction(function() {
            conn.close(function() {});
            return callback && callback(err);
          });
        } else {
          options.transaction = undefined;
          conn.commitTransaction(function(err) {
            if (err) {
              return callback && callback(err);
            }

            conn.close(function() {});
            return callback && callback(null, data, meta);
          });
        }
      });
    });
  }
};

IBMDB.prototype.buildReplace = function(model, where, data, options) {
  debug('IBMDB.prototype.buildReplace: model=$s, where=%j, options=%j',
    model, where, options);
  var self = this;
  var idName = self.idName(model);
  var fields = self.buildFieldsForReplace(model, data);
  var updateClause = new ParameterizedSQL('UPDATE ' + self.tableEscaped(model));
  var whereClause = self.buildWhere(model, where);
  var selectClause = new ParameterizedSQL('SELECT COUNT(\"' + idName + '\") ' +
                                      'AS \"affectedRows\" FROM FINAL TABLE(');

  updateClause.merge([fields, whereClause]);
  selectClause.merge([updateClause, ')']);

  return (selectClause);
};

IBMDB.prototype.getCountForAffectedRows = function(model, info) {
  var affectedRows = info && info[0] &&
      typeof info[0].affectedRows === 'number' ?
    info[0].affectedRows : undefined;
  return affectedRows;
};

IBMDB.prototype.createTable = function(model, cb) {
  debug('IBMDB.prototype.createTable');
  var self = this;
  var tableName = self.tableEscaped(model);
  var tableSchema = self.schema;
  var columnDefinitions = self.buildColumnDefinitions(model);
  var tasks = [];
  var options = {
    noResultSet: true,
  };

  tasks.push(function(callback) {
    var sql = 'CREATE TABLE ' + tableSchema + '.' + tableName +
              ' (' + columnDefinitions + ');';
    self.execute(sql, null, options, callback);
  });

  var indexes = self.buildIndexes(model);
  indexes.forEach(function(i) {
    tasks.push(function(callback) {
      self.execute(i, null, options, callback);
    });
  });

  async.series(tasks, cb);
};

/**
 * Drop the table for the given model from the database
 *
 * @param {string} model The model name
 * @param {Function} [cb] The callback function
 */
IBMDB.prototype.dropTable = function(model, cb) {
  debug('IBMDB.prototype.dropTable');
  var self = this;
  var dropStmt = 'DROP TABLE ' + self.schema + '.' +
                 self.tableEscaped(model);
  var options = {
    noResultSet: true,
  };

  options.noResultSet = true;

  self.execute(dropStmt, null, options, function(err, countData) {
    if (err) {
      if (!err.toString().includes('42704')) {
        return cb && cb(err);
      }
    }
    return cb && cb();
  });
};

IBMDB.prototype.buildColumnDefinitions = function(model) {
  debug('IBMDB.prototype.buildColumnDefinitions');
  var self = this;
  var sql = [];
  var definition = this.getModelDefinition(model);
  var pks = this.idNames(model).map(function(i) {
    return self.columnEscaped(model, i);
  });
  Object.keys(definition.properties).forEach(function(prop) {
    var colName = self.columnEscaped(model, prop);
    sql.push(colName + ' ' + self.buildColumnDefinition(model, prop));
  });
  if (pks.length > 0) {
    sql.push('PRIMARY KEY(' + pks.join(',') + ')');
  }

  return sql.join(',\n');
};

/**
 * Build SQL expression
 * @param {String} columnName Escaped column name
 * @param {String} operator SQL operator
 * @param {*} columnValue Column value
 * @param {*} propertyValue Property value
 * @returns {ParameterizedSQL} The SQL expression
 */
IBMDB.prototype.buildExpression =
function(columnName, operator, columnValue, propertyValue) {
  function buildClause(columnValue, separator, grouping) {
    var values = [];
    for (var i = 0, n = columnValue.length; i < n; i++) {
      if (columnValue[i] instanceof ParameterizedSQL) {
        values.push(columnValue[i]);
      } else {
        values.push(new ParameterizedSQL(PLACEHOLDER, [columnValue[i]]));
      }
    }
    separator = separator || ',';
    var clause = ParameterizedSQL.join(values, separator);
    if (grouping) {
      clause.sql = '(' + clause.sql + ')';
    }
    return clause;
  }

  var self = this;
  var sqlExp = columnName;
  var clause, stmt;
  if (columnValue instanceof ParameterizedSQL) {
    clause = columnValue;
  } else {
    clause = new ParameterizedSQL(PLACEHOLDER, [columnValue]);
  }
  switch (operator) {
    case 'gt':
      sqlExp += '>';
      break;
    case 'gte':
      sqlExp += '>=';
      break;
    case 'lt':
      sqlExp += '<';
      break;
    case 'lte':
      sqlExp += '<=';
      break;
    case 'between':
      sqlExp += ' BETWEEN ';
      clause = buildClause(columnValue, ' AND ', false);
      break;
    case 'inq':
      sqlExp += ' IN ';
      clause = buildClause(columnValue, ',', true);
      break;
    case 'nin':
      sqlExp += ' NOT IN ';
      clause = buildClause(columnValue, ',', true);
      break;
    case 'neq':
      if (columnValue == null) {
        return new ParameterizedSQL(sqlExp + ' IS NOT NULL');
      }
      sqlExp += '!=';
      break;
    case 'like':
      sqlExp += ' LIKE ';
      break;
    case 'nlike':
      sqlExp += ' NOT LIKE ';
      break;
    case 'regexp':
      // doc on `regexp_like`: https://www.ibm.com/support/knowledgecenter/SSEPGG_11.1.0/com.ibm.db2.luw.sql.ref.doc/doc/r0061494.html
      var ignCaseFlag = columnValue.ignoreCase ? 'i' : 'c';
      var multiLineFlag = columnValue.multiline ? 'm' : '';
      var flags = ignCaseFlag + multiLineFlag;

      sqlExp = `REGEXP_LIKE(${columnName}, '${columnValue.source}', 
      '${flags}')`;
      return sqlExp;
  }
  stmt = ParameterizedSQL.join([sqlExp, clause], '');
  return stmt;
};

IBMDB.prototype.buildIndex = function(model, property) {
  debug('IBMDB.prototype.buildIndex');
  var self = this;
  var prop = self.getPropertyDefinition(model, property);
  var i = prop && prop.index;
  if (!i) {
    return '';
  }

  var statement = new ParameterizedSQL('CREATE');
  if (i.kind) {
    statement.merge(i.kind);
  } else if (i.unique) {
    statement.merge('UNIQUE');
  }

  var columnName = self.columnEscaped(model, property);

  statement.merge('INDEX ' + columnName + ' ON ' + self.schema + '.');
  statement.merge(self.tableEscaped(model) + '(' + columnName + ')');

  return (statement.sql);
};

IBMDB.prototype.buildIndexes = function(model) {
  debug('IBMDB.prototype.buildIndexes');
  var self = this;
  var indexClauses = [];
  var definition = this.getModelDefinition(model);
  var indexes = definition.settings.indexes || {};
  /*!
    This module did not allow to define indexes the "new" way loopback wants to.
    - The new way to define indexes in loopback
    (https://loopback.io/doc/en/lb3/Model-definition-JSON-file.html#indexes)
      "name_key": {
        "columns": "name",
        "unique": true
      }
    - The way the module previously accepted indexes:
      "name_key": {
        "keys" : {
          "name": 1
        }
      }
    The module now allows both ways to define the indexes.
  */
  // Build model level indexes
  for (var index in indexes) {
    var i = indexes[index];
    var statement = new ParameterizedSQL('CREATE');
    if (i.kind) {
      statement.merge(i.kind);
    } else if ((i.options && i.options.unique && i.options.unique === true) ||
      i.unique) {
      // if index unique indicator is configured
      statement.merge('UNIQUE');
    }
    var indexedColumns = [];
    var columns = '';
    // if indexes are configured as "keys"
    if (i.keys) {
      // for each field in "keys" object
      for (var key in i.keys) {
        // index in asc order
        if (i.keys[key] !== -1) {
          indexedColumns.push(key);
        } else {
          // index in desc order
          indexedColumns.push(key + ' DESC');
        }
      }
    }
    if (indexedColumns.length) {
      columns = indexedColumns.join(',');
    } else if (i.columns) {
      columns = i.columns.split(',').map(function(val) {
        return self.escapeName(val);
      });
    }

    statement.merge('INDEX ' + self.escapeName(index) + ' ON ');
    statement.merge(self.schema + '.' + self.tableEscaped(model));
    statement.merge('(' + columns + ')');

    indexClauses.push(statement.sql);
  }
  return indexClauses;
};

IBMDB.prototype.buildColumnDefinition = function(model, prop) {
  debug('IBMDB.prototype.buildColumnDefinition: prop = %j', prop);
  var p = this.getPropertyDefinition(model, prop);
  if (p.id && p.generated) {
    return 'INT NOT NULL GENERATED BY DEFAULT' +
      ' AS IDENTITY (START WITH 1 INCREMENT BY 1)';
  }
  var line = this.columnDataType(model, prop) + ' ' +
      (this.isNullable(p) ? '' : 'NOT NULL');
  return line;
};

IBMDB.prototype.columnDataType = function(model, property) {
  debug('IBMDB.prototype.columnDataType: property = %j', property);
  var prop = this.getPropertyDefinition(model, property);
  if (!prop) {
    return null;
  }
  return this.buildColumnType(prop);
};

IBMDB.prototype.buildColumnType = function buildColumnType(propertyDefinition) {
  debug('IBMDB.prototype.buildColumnType: propertyDefinition=%j',
    propertyDefinition);
  var self = this;
  var dt = '';
  var p = propertyDefinition;
  var type = p.type.name;

  switch (type) {
    default:
    case 'JSON':
    case 'Object':
    case 'Any':
    case 'Text':
    case 'String':
      dt = self.convertTextType(p, 'VARCHAR');
      break;
    case 'Number':
      dt = self.convertNumberType(p, 'INTEGER');
      break;
    case 'Date':
      dt = 'TIMESTAMP';
      break;
    case 'Boolean':
      dt = 'SMALLINT';
      break;
    case 'Point':
    case 'GeoPoint':
      dt = 'POINT';
      break;
    case 'Enum':
      dt = 'ENUM(' + p.type._string + ')';
      dt = stringOptions(p, dt);
      break;
  }
  debug('IBMDB.prototype.buildColumnType %j %j', p.type.name, dt);
  return dt;
};

IBMDB.prototype.convertTextType = function convertTextType(p, defaultType) {
  debug('IBMDB.prototype.convertTextType: defaultType = %j', defaultType);
  var self = this;
  var dt = defaultType;
  var len = p.length ||
    ((p.type !== String) ? 4096 : p.id ? 255 : 512);

  if (p[self.name]) {
    if (p[self.name].dataLength) {
      len = p[self.name].dataLength;
    }
  }

  if (p[self.name] && p[self.name].dataType) {
    dt = String(p[self.name].dataType);
  } else if (p.dataType) {
    dt = String(p.dataType);
  }

  dt += '(' + len + ')';

  stringOptions(p, dt);

  return dt;
};

IBMDB.prototype.convertNumberType = function convertNumberType(p, defaultType) {
  debug('IBMDB.prototype.convertNumberType: defaultType = %j', defaultType);
  var self = this;
  var dt = defaultType;
  var precision = p.precision;
  var scale = p.scale;

  if (p[self.name] && p[self.name].dataType) {
    dt = String(p[self.name].dataType);
    precision = p[self.name].dataPrecision;
    scale = p[self.name].dataScale;
  } else if (p.dataType) {
    dt = String(p.dataType);
  } else {
    return dt;
  }

  switch (dt) {
    case 'DECIMAL':
      dt = 'DECIMAL';
      if (precision && scale) {
        dt += '(' + precision + ',' + scale + ')';
      } else if (scale > 0) {
        throw new Error(g.f('Scale without Precision does not make sense'));
      }
      break;
    default:
      break;
  }

  return dt;
};

function stringOptions(p, columnType) {
  if (p.charset) {
    columnType += ' CHARACTER SET ' + p.charset;
  }
  if (p.collation) {
    columnType += ' COLLATE ' + p.collation;
  }
  return columnType;
};

function buildLimit(limit, offset) {
  if (isNaN(limit)) { limit = 0; }
  if (isNaN(offset)) { offset = 0; }
  if (!limit && !offset) {
    return '';
  }
  if (limit && !offset) {
    return 'FETCH FIRST ' + limit + ' ROWS ONLY';
  }
  if (offset && !limit) {
    return 'OFFSET ' + offset;
  }
  return 'LIMIT ' + limit + ' OFFSET ' + offset;
}

IBMDB.prototype.applyPagination = function(model, stmt, filter) {
  debug('IBMDB.prototype.applyPagination');
  var limitClause = buildLimit(filter.limit, filter.offset || filter.skip);
  return stmt.merge(limitClause);
};

function errorIdNotFoundForReplace(idValue) {
  var msg = g.f('Could not replace. Object with id %s does not exist!',
    idValue);
  var error = new Error(msg);
  error.statusCode = error.status = 404;
  return error;
}

require('./migration')(IBMDB);
