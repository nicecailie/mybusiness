// Passenger requires a CommonJS entry point; the application itself remains ESM.
import('./server.mjs').catch((error) => {
  console.error(
    'MyBusiness startup failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
