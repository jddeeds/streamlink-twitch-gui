var consoleMethod = "info";

/**
 * @returns {Promise}
 */
module.exports = function( grunt, options, cdp ) {
	var UUID = "qunit_" + Date.now() + "_" + Math.random().toString( 36 ).substring( 2, 15 );

	function promiseQUnitBridge( resolve, reject ) {
		var started = false;

		// wait X seconds for QUnit to start or reject the promise
		var startTimeout = setTimeout( function() {
			reject( "Timeout: Missing QUnit.start() call" );
		}, options.startTimeout );
		// wait X seconds for all tests to finish
		var testTimeout;

		// listen for qunit messages
		cdp.on( "Runtime.consoleAPICalled", function( obj ) {
			if ( !obj || !obj.type || obj.type !== consoleMethod ) { return; }
			var params = obj.args;
			if ( !params || params.length !== 3 || params[ 0 ].value !== UUID ) { return; }
			var event = params[ 1 ].value;
			var data = JSON.parse( params[ 2 ].value );

			switch ( event ) {
				case "begin":
					if ( started === true ) { return; }
					started = true;

					if ( startTimeout ) {
						clearTimeout( startTimeout );
					}

					testTimeout = setTimeout(function() {
						reject( "Timeout: The tests did not finish..." );
					}, options.testTimeout );
					return;

				case "moduleDone":
					if ( !options.logModules ) { return; }

					grunt.log[ data.failed === 0 ? "ok" : "warn" ](
						data.name + " (" + data.passed + "/" + data.total + ")"
					);
					return;

				case "done":
					if ( testTimeout ) {
						clearTimeout( testTimeout );
					}

					if ( options.logModules && data.total > 0 ) {
						grunt.log.writeln( "" );
					}

					// resolve or reject the promise
					if ( data.failed === 0 && data.passed === data.total ) {
						if ( data.total === 0 ) {
							grunt.log.warn(
								"0/0 assertions ran (" + data.runtime + "ms)"
							);
						} else if ( data.total > 0 ) {
							grunt.log.ok(
								data.total + " assertions passed (" + data.runtime + "ms)"
							);
						}
						resolve();
					} else {
						grunt.log.warn(
							  data.failed + "/" + data.total
							+ " assertions failed (" + data.runtime + "ms)"
						);
						reject();
					}
					return;
			}
		});


		/*
		 * This function will be executed by NW.js over the remote connection
		 */
		function setupQUnit( QUnit ) {
			delete global._setupQUnitBridge;

			function logMessage( callback, obj ) {
				console[ "%METHOD%" ]( "%UUID%", callback, JSON.stringify( obj ) );
			}

			[
				"testStart",
				"testDone",
				"moduleStart",
				"moduleDone",
				"begin",
				"done"
			].forEach(function( callback ) {
				QUnit[ callback ]( logMessage.bind( null, callback ) );
			});

			QUnit.start();
		}

		var expression = [
			"(function() {",
			setupQUnit
				.toString()
				.replace( "%METHOD%", consoleMethod )
				.replace( "%UUID%", UUID ),
			"if ( global._setupQUnitBridge ) {",
			"setupQUnit( global._setupQUnitBridge );",
			"} else {",
			"global._setupQUnitBridge = setupQUnit;",
			"}",
			"})();"
		].join( "\n" );

		// setup & start QUnit
		cdp.send( "Runtime.evaluate", { expression: expression } )
			.then(function() {
				grunt.log.debug( "QUnit test reporter injected and QUnit started" );
			});
	}


	return cdp.send( "Runtime.enable" )
		.then(function() {
			return new Promise( promiseQUnitBridge );
		});
};
