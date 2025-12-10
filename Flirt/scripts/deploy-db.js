#!/usr/bin/env node

/**
 * Deploy Database Script for Railway
 *
 * Copies the seed database from git to the production location
 * during Railway deployment.
 */

const fs = require('fs');
const path = require('path');

function deployDatabase() {
  console.log('🚀 Starting database deployment...');
  console.log('📍 Current working directory:', process.cwd());
  console.log('📍 Script directory:', __dirname);

  const sourceDb = path.join(__dirname, '..', 'db', 'flirt.db');
  const productionDir = '/app/data';
  const targetDb = path.join(productionDir, 'flirt.db');

  console.log('📋 Source database path:', sourceDb);
  console.log('📋 Target database path:', targetDb);

  try {
    // Check if source database exists
    if (!fs.existsSync(sourceDb)) {
      console.log('⚠️  Source database not found at:', sourceDb);
      console.log('   This might be expected if running locally.');
      return;
    }

    // Create production directory if it doesn't exist
    if (!fs.existsSync(productionDir)) {
      console.log('📁 Creating production directory:', productionDir);
      fs.mkdirSync(productionDir, { recursive: true });
    }

    // Always copy the database from git to production volume
    console.log('📋 Copying database from:', sourceDb);
    console.log('📋 Copying database to:', targetDb);

    if (fs.existsSync(targetDb)) {
      const existingSize = fs.statSync(targetDb).size;
      console.log(`⚠️  Overwriting existing database (${(existingSize / 1024 / 1024).toFixed(2)} MB)`);
    }

    fs.copyFileSync(sourceDb, targetDb);

    // Verify the copy
    const sourceSize = fs.statSync(sourceDb).size;
    const targetSize = fs.statSync(targetDb).size;

    if (sourceSize === targetSize) {
      console.log('✅ Database deployed successfully!');
      console.log(`   Size: ${(targetSize / 1024 / 1024).toFixed(2)} MB`);
    } else {
      console.error('❌ Database copy verification failed!');
      console.error(`   Source: ${sourceSize} bytes`);
      console.error(`   Target: ${targetSize} bytes`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Database deployment failed:', error.message);
    console.error('   This might be expected in some environments.');
    console.log('   The application will use database initialization instead.');
  }
}

// Run the deployment
deployDatabase();
