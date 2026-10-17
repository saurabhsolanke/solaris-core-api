import { buildApp } from './app';
import { env } from './config/env';
import { checkDatabaseConnection, closeDatabasePool } from './config/database';

async function startServer(): Promise<void> {
  const app = await buildApp();

  try {
    // Check database connection before listening
    const dbStatus = await checkDatabaseConnection();
    if (dbStatus.ok) {
      app.log.info(`✅ PostgreSQL Database connected (${dbStatus.postgisVersion})`);
    } else {
      app.log.warn(`⚠️ PostgreSQL connection warning: ${dbStatus.error}. Server will still start.`);
    }

    // Start listening
    await app.listen({ port: env.PORT, host: env.HOST });

    console.log(`
======================================================================
🚀 SOLARIS CORE API IS RUNNING
======================================================================
📡 HTTP Server:    http://${env.HOST}:${env.PORT}
📄 Swagger Docs:   http://${env.HOST}:${env.PORT}/docs
🩺 Health Check:   http://${env.HOST}:${env.PORT}/health
🌍 Environment:    ${env.NODE_ENV}
======================================================================
    `);

    // Graceful Shutdown Handlers
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
      process.on(signal, async () => {
        app.log.info(`Received ${signal}. Shutting down gracefully...`);
        try {
          await app.close();
          await closeDatabasePool();
          app.log.info('Server and database pool closed cleanly.');
          process.exit(0);
        } catch (err) {
          app.log.error(err, 'Error during shutdown');
          process.exit(1);
        }
      });
    }
  } catch (err) {
    app.log.error(err, 'Failed to start SOLARIS backend service');
    process.exit(1);
  }
}

// Start execution
startServer();
