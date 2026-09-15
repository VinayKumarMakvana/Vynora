import mongoose from 'mongoose';
import { Config } from '../src/models/Config';
mongoose.connect('mongodb+srv://vinaytailor52188_db_user:xTcg2NKQDrySC2QG@vynora.dhztods.mongodb.net/?appName=Vynora').then(async () => {
  await Config.updateOne({ config_key: 'ai_model_name' }, { $set: { config_value: 'gemini-flash-latest' } }, { upsert: true });
  console.log('Model updated to gemini-flash-latest');
  process.exit(0);
});
