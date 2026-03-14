import { app, buildApp } from './app';

const port = Number(process.env.PORT) || 3333;

async function start() {
  await buildApp();
  
  app.listen({ port, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    console.log(`back rathole running on ${address}`);
  });
}

start();