// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-connector-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

/*!
 * Common connector infrastructure for IBM database connectors.
 */
var SqlConnector = require('loopback-connector').SqlConnector;
var ParameterizedSQL = SqlConnector.ParameterizedSQL;
var Driver = require('ibm_db');
var util = require('util');
var debug = require('debug')('loopback:connector:ibmdb');
var async = require('async');
var Transaction = require('loopback-connector').Transaction;

/**
 * Initialize the IBMDB connector for the given data source
 *
 * @param {DataSource} ds The data source instance
 * @param {Function} [cb] The cb function
 */
exports.initialize = function(ds, cb) {
  ds.connector = new IBMDB(ds.settings);
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

/**
 * The constructor for the IBMDB LoopBack connector
 *
 * @param {Object} settings The settings object
 * @constructor
 */
function IBMDB(settings) {
  debug('IBMDB constructor settings: %j', settings);
  SqlConnector.call(this, 'IBMDB', settings);
  this.debug = settings.debug || debug.enabled;
  this.useLimitOffset = settings.useLimitOffset || false;
  this.client = new Driver.Pool();
  this.dbname = (settings.database || settings.db || 'testdb');
  this.dsn = settings.dsn;
  this.hostname = (settings.hostname || settings.host);
  this.username = (settings.username || settings.user);
  this.password = settings.password;
  this.portnumber = settings.port;
  this.protocol = (settings.protocol || 'TCPIP');
  this.supportColumnStore = (settings.supportColumnStore || false);
  this.supportDashDB = (settings.supportDashDB || false);
  this.isIBMDBz = (settings.supportIBMDBz || false);

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
      'DRIVER={' + this.driver + '}' +
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
}

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

util.inherits(IBMDB, SqlConnector);

IBMDB.prototype.ping = function(cb) {
  var self = this;

  if (self.dataSource.connection) {
    if (!testConnection(self.dataSource.connection)) {
      return cb && cb(Error('Failed to use connection'));
    }
    cb && cb();
  } else {
    self.connect(function(err, conn) {
      if (err) {
        cb && cb(Error(err));
      } else if (!testConnection(conn)) {
        cb && cb(Error('Failed to use connection'));
      } else {
        cb && cb();
      }
    });
  }

  return;
};

IBMDB.prototype.tableEscaped = function(model) {
  var escapedName = this.escapeName(this.table(model));
  return escapedName;
};

/**
 * Connect to IBMDB
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
 * Execute the sql statement
 *
 */
IBMDB.prototype.executeSQL = function(sql, params, options, callback) {
  debug('IBMDB.prototype.executeSQL (enter)',
        sql, params, options);
  var self = this;
  var conn = self.connection;

  if (options.transaction) {
    conn = options.transaction.connection;
  }

  conn.query(sql, params, function(err, data, more) {
    debug('IBMDB.prototype.executeSQL (exit)' +
          ' sql=%j params=%j err=%j data=%j more=%j',
          sql, params, err, data, more);
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
