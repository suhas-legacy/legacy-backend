const dbService = require('../database');

async function test() {
  await dbService.init();
  try {
    const res = await dbService.pool.query("SELECT * FROM legacy_website.visitor_requests ORDER BY created_at DESC LIMIT 5");
    console.log("LAST 5 REQUESTS:");
    console.log(JSON.stringify(res.rows, null, 2));

    const cols = await dbService.pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'legacy_website' AND table_name = 'visitor_requests'
    `);
    console.log("COLUMNS IN DATABASE:");
    console.log(cols.rows);
    const timeRes = await dbService.pool.query("SELECT NOW()");
    console.log("DB CURRENT TIME:", timeRes.rows[0].now);
  } catch (err) {
    console.error("DB error:", err);
  } finally {
    await dbService.close();
  }
}

test();
