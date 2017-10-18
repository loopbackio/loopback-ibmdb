2017-10-18, Version 2.3.0
=========================

 * update dependencies (Diana Lau)

 * Add stalebot configuration (Kevin Delisle)


2017-08-21, Version 2.2.2
=========================

 * Create Issue and PR Templates (#62) (Sakib Hasan)

 * Update translated strings Q3 2017 (Allen Boone)

 * update translation file (Diana Lau)

 * Add CODEOWNER file (Diana Lau)

 * Override buildExpression from base connector (ssh24)

 * Update linter and rules (ssh24)

 * Fix drop/build primary indexes (ssh24)

 * Fix bad calls to columnEscaped (ssh24)

 * Escape column names on add/change/drop (ssh24)


2017-07-12, Version 2.2.1
=========================

 * add test case for fromColumnValue (Diana Lau)

 * fix fromColumnValue when val is undefined (Diana Lau)

 * Remove connection string logging (#50) (Quentin Presley)

 * Make the autoupdate logic much more generic (#48) (Quentin Presley)


2017-03-31, Version 2.2.0
=========================

 * Replace discovery migration (#47) (Quentin Presley)

 * Add debug on alterTable (#46) (Sakib Hasan)

 * refactor alterTable (#45) (Biniam Admikew)


2017-03-10, Version 2.1.0
=========================

 * Set connection properties (#44) (Quentin Presley)

 * Fix replaceById bug (Loay)

 * Upgrade to loopback-connector@4.0.0 (jannyHou)

 * Use trim on table name (ssh24)

 * Refactor migration methods (biniam)


2017-03-01, Version 2.0.0
=========================

 * Drop support for node@10,12 (jannyHou)

 * Upgrade to loopback-connector@3.x (jannyHou)

 * Update ibm_db minimum version (#34) (Quentin Presley)

 * Coerce various pooling configs into integers (#32) (Simon Ho)

 * put issues tab back (siddhipai)

 * Fix issues redirection in package.json (Siddhi Pai)

 * Remove issues warning from README.md (Siddhi Pai)

 * Add translation files (Candy)


2016-11-02, Version 1.0.12
==========================

 * remove connect/lazyconnect (#27) (Quentin Presley)

 * Add initial settings config (#26) (Quentin Presley)

 * Add connectorCapabilities global object (#24) (Nicholas Duffy)

 * Redirect users to log issues in loopback (Candy)

 * deps: remove extraneous dependencies (Ryan Graham)


2016-09-28, Version 1.0.11
==========================

 * add some simple tests (#19) (Ryan Graham)

 * Debug fixes (#20) (Quentin Presley)


2016-09-27, Version 1.0.10
==========================

 * Ensure connection close on failure (#18) (Quentin Presley)

 * Add license text (Candy)

 * Add globalization (Candy)


2016-09-22, Version 1.0.9
=========================

 * Add CurrentSchema to connStr (Quentin Presley)

 * Update deps to loopback 3.0.0 RC (Miroslav Bajtoš)


2016-09-21, Version 1.0.8
=========================

 * Revert CurrentSchema change (Quentin Presley)


2016-09-21, Version 1.0.7
=========================

 * Remove CurrentSchema from DSN (Quentin Presley)

 * Need to close connections to return to pool (#13) (Quentin Presley)


2016-09-16, Version 1.0.6
=========================

 * Pooling defect (#12) (Quentin Presley)


2016-09-12, Version 1.0.5
=========================

 * 1.0.5 : Fix connection drop on idle traffic (#10) (Naveen Venkat)

 * Use juggler@3 for running the tests (Candy)


2016-08-18, Version 1.0.4
=========================

 * Remove commented out code (Quentin Presley)

 * Stability fixes (#7) (Quentin Presley)


2016-08-05, Version 1.0.3
=========================

 * Add replaceOrCreate support for DB2 (Alex Pitigoi)


2016-07-18, Version 1.0.2
=========================

 * Update URLs in CONTRIBUTING.md (#5) (Ryan Graham)

 * Avoid update all in save and updateOrCreate (Amir Jafarian)

 * `toColumnValue()` should treat undefined. (Amir Jafarian)


2016-05-30, Version 1.0.1
=========================

 * Updates to package naming (Quentin Presley)


2016-05-30, Version 1.0.0
=========================

 * First release!
