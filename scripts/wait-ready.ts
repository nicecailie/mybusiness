const end = Date.now() + 120000;
while (Date.now() < end) {
  try {
    const response = await fetch('http://localhost:3000/api/v1/health');
    if (response.ok) {
      console.log('Local HTTP services ready.');
      process.exit(0);
    }
  } catch {
    /* Cold starts may be retried. */
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
throw new Error('Local HTTP services did not become ready.');
export {};
