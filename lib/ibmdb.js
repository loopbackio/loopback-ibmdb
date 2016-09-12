// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-connector-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

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

/**
 * Initialize the IBMDB connector for the given data source
 *
 * @param {DataSource} ds The data source instance
 * @param {Function} [cb] The cb function
 */
exports.initialize = function(ds, cb) {
  ds.connector = new IBMDB('IBMDB', ds.settings);
  ds.connector.dataSource = ds;
  if (cb) {
    if (ds.settings.lazyConnect) {
      process.nextTick(function() {
        cb();
      });
    } else {
      ds.connector.connect(cb);
    }
  }
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
  debug('IBMDB constructor settings: %j', settings);
  SQLConnector.call(this, name, settings);
  this.client = new Driver.Pool();
  this.dbname = (settings.database || settings.db || 'testdb');
  this.dsn = settings.dsn;
  this.hostname = (settings.hostname || settings.host);
  this.username = (settings.username || settings.user);
  this.password = settings.password;
  this.portnumber = settings.port;
  this.protocol = (settings.protocol || 'TCPIP');

  var dsn = settings.dsn;
  if (dsn) {
    this.connStr = dsn;

    var DSNObject = parseDSN(dsn);
    if (!('CurrentSchema' in DSNObject)) {
      this.connStr += ';CurrentSchema=' + DSNObject.UID;
    }
    this.schema = DSNObject.CurrentSchema || DSNObject.UID;
  } else {
    var connStrGenerate =
      'DRIVER={' + name + '}' +
      ';DATABASE=' + this.dbname +
      ';HOSTNAME=' + this.hostname +
      ';UID=' + this.username +
      ';PWD=' + this.password +
      ';PORT=' + this.portnumber +
      ';PROTOCOL=' + this.protocol;
    this.connStr = connStrGenerate;

    this.schema = this.username;
    if (settings.schema) {
      this.connStr += ';CurrentSchema=' + settings.schema;
      this.schema = settings.schema.toUpperCase();
    }
  }
};

util.inherits(IBMDB, SQLConnector);

function parseDSN(dsn) {
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
}

IBMDB.prototype.tableEscaped = function(model) {
  var escapedName = this.escapeName(this.table(model));
  return escapedName;
};

IBMDB.prototype.ping = function(cb) {
  var self = this;
  var sql = 'SELECT COUNT(*) AS COUNT FROM SYSIBM.SYSTABLES';

  if (self.dataSource.connection) {
    if (!self.testConnection(self.dataSource.connection, sql)) {
      return cb && cb(Error('Failed to use connection'));
    }
    cb && cb();
  } else {
    self.connect(function(err, conn) {
      if (err) {
        cb && cb(Error(err));
      } else if (!self.testConnection(conn, sql)) {
        cb && cb(Error('Failed to use connection'));
      } else {
        cb && cb();
      }
    });
  }

  return;
};

IBMDB.prototype.testConnection = function(conn, sql) {
  var rows = conn.querySync(sql, null);

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
    console.log('Invalid connection string: ', self.connStr);
    return (cb && cb());
  }

  self.dataSource.connecting = true;
  self.client.open(this.connStr, function(err, con) {
    debug('IBMDB.prototype.connect (%s) err=%j con=%j', self.connStr, err, con);
    if (err) {
      self.dataSource.connected = false;
      self.dataSource.connecting = false;
    } else {
      self.connection = con;
      self.dataSource.connected = true;
      self.dataSource.connecting = false;
      self.dataSource.emit('connected');
    }
    cb && cb(err, con);
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
  debug('DB2.prototype.executeSQL (enter)',
        sql, params, options);
  var self = this;
  var conn = self.connection;
  var stmt = {};

  if (!self.connection.connected) {
    self.dataSource.connected = false;
    self.dataSource.connecting = false;
  }
  stmt.noResults = (options && options.noResults) ? options.noResults : false;

  if (options.transaction) {
    conn = options.transaction.connection;
  }

  var limit = 0;
  var offset = 0;
  // This is standard DB2 syntax. LIMIT and OFFSET
  // are configured off by default. Enable these to
  // leverage LIMIT and OFFSET.
  if (!this.useLimitOffset) {
    var res = sql.match(self.limitRE);
    if (res) {
      limit = Number(res[1]);
      sql = sql.replace(self.limitRE, '');
    }
    res = sql.match(this.offsetRE);
    if (res) {
      offset = Number(res[1]);
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
    debug('DB2.prototype.executeSQL (exit)' +
          ' stmt=%j params=%j err=%j data=%j more=%j',
          stmt, err, data, more);
    // schedule callback as there is more code to
    // execute in the db2 driver to cleanup the current query
    if (offset || limit) {
      data = data.slice(offset, offset + limit);
    }

    if (!err) {
      if (more) {
        process.nextTick(function() {
          return callback(err, data);
        });
      }
    }

    callback && callback(err, data);
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

function dateToIBMDB(val) {
  var dateStr = val.getFullYear() + '-'
      + fillZeros(val.getMonth() + 1) + '-'
      + fillZeros(val.getDate()) + '-'
      + fillZeros(val.getHours()) + '.'
      + fillZeros(val.getMinutes()) + '.'
      + fillZeros(val.getSeconds()) + '.';
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
  if (val === null || !prop) {
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
  throw new Error('Placeholder for identifiers is not supported: ' + key);
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
          return callback && callback(err);
        }
        executeWithConnection(conn, function(err, data, meta) {
          if (err) {
            conn.rollbackTransaction(function(err) {
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
 * @param {Function} [callback] The callback function
 */
IBMDB.prototype.replaceOrCreate = IBMDB.prototype.replace =
  function(model, data, options, callback) {
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

      var countStmt = new ParameterizedSQL('SELECT COUNT(*) AS CNT FROM ');
      countStmt.merge(tableName);
      countStmt.merge(self.buildWhere(model, where));
      countStmt.noResults = false;

      connection.query(countStmt, function(err, countData) {
        debug('IBMDB.prototype.replaceOrCreate (data): err=%j, countData=%j\n',
              err, countData);
        if (err) return cb(err);

        if (countData[0]['CNT'] > 0) {
          // remove existing to replace with a new insert
          stmt = self.buildDelete(model, where);
          stmt.noResults = true;
          connection.query(stmt, function(err, res) {
            debug('IBMDB.prototype.replaceOrCreate (data): err=%j, res=%j\n',
                  err, res);

            if (err) return cb(err);
          });
        }
        stmt = self.buildInsert(model, data);
        stmt.noResults = true;

        connection.query(stmt, function(err, sData) {
          debug('IBMDB.prototype.replaceOrCreate (data): err=%j, sData=%j\n',
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
          return callback && callback(err);
        }
        executeWithConnection(conn, function(err, data, meta) {
          if (err) {
            conn.rollbackTransaction(function(err) {
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
 * Create the table for the given model
 *
 * @param {string} model The model name
 * @param {Object} [options] options
 * @param {Function} [cb] The callback function
 */
IBMDB.prototype.createTable = function(model, options, cb) {
  debug('IBMDB.prototype.createTable ', model, options);
  cb();
};

IBMDB.prototype.buildIndex = function(model, property) {
  debug('IBMDB.prototype.buildIndex %j %j', model, property);
};

IBMDB.prototype.buildIndexes = function(model) {
  debug('IBMDB.prototype.buildIndexes %j', model);
};

IBMDB.prototype.getCountForAffectedRows = function(model, info) {
  var affectedRows = info && typeof info.affectedRows === 'number' ?
      info.affectedRows : undefined;
  return affectedRows;
};

IBMDB.prototype.createTable = function(model, cb) {
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

IBMDB.prototype.buildIndex = function(model, property) {
  var self = this;
  // var prop = self.getModelDefinition(model).properties[property];
  var prop = self.getPropertyDefinition(model, property);
  var i = prop && prop.index;
  if (!i) {
    return '';
  }

  var stmt = 'CREATE ';
  var kind = '';
  if (i.kind) {
    kind = i.kind;
  }
  var columnName = self.columnEscaped(model, property);
  if (typeof i === 'object' && i.unique && i.unique === true) {
    kind = 'UNIQUE';
  }
  return (stmt + kind + ' INDEX ' + columnName +
          ' ON ' + self.schema + '.' + self.tableEscaped(model) +
          ' (' + columnName + ');\n');
};

IBMDB.prototype.buildIndexes = function(model) {
  var indexClauses = [];
  var definition = this.getModelDefinition(model);
  var indexes = definition.settings.indexes || {};
  // Build model level indexes
  for (var index in indexes) {
    var i = indexes[index];
    var stmt = 'CREATE ';
    var kind = '';
    if (i.kind) {
      kind = i.kind;
    }
    var indexedColumns = [];
    var indexName = this.escapeName(index);
    if (Array.isArray(i.keys)) {
      indexedColumns = i.keys.map(function(key) {
        return this.columnEscaped(model, key);
      });
    }

    var columns = (i.columns.split(/,\s*/)).join('\",\"');
    if (indexedColumns.length > 0) {
      columns = indexedColumns.join('\",\"');
    }

    indexClauses.push(stmt + kind + ' INDEX ' + indexName +
                      ' ON ' + this.schema + '.' + this.tableEscaped(model) +
                      ' (\"' + columns + '\");\n');
  }

  // Define index for each of the properties
  // for (var p in definition.properties) {
  //   var propIndex = this.buildIndex(model, p);
  //   if (propIndex) {
  //     indexClauses.push(propIndex);
  //   }
  // }

  return indexClauses;
};

IBMDB.prototype.buildColumnDefinition = function(model, prop) {
  // var p = this.getModelDefinition(model).properties[prop];
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
  var prop = this.getPropertyDefinition(model, property);
  if (!prop) {
    return null;
  }
  return this.buildColumnType(prop);
};

IBMDB.prototype.buildColumnType = function buildColumnType(propertyDefinition) {
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
        throw new Error('Scale without Precision does not make sense');
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
