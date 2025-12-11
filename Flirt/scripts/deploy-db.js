#!/usr/bin/env node

/**
 * Deploy Database Script for Railway
 *
 * Only copies the seed database if NO production database exists.
 * This preserves production data across deployments.
 */

const fs = require('fs');
const path = require('path');

function deployDatabase() {
  console.log('🚀 Starting database deployment check...');

  const sourceDb = path.join(__dirname, '..', 'db', 'flirt.db');
  const productionDir = '/app/data';
  const targetDb = path.join(productionDir, 'flirt.db');

  console.log('📋 Source database path:', sourceDb);
  console.log('📋 Target database path:', targetDb);

  try {
    // Check if production directory exists
    if (!fs.existsSync(productionDir)) {
      console.log('📁 Creating production directory:', productionDir);
      fs.mkdirSync(productionDir, { recursive: true });
    }

    // Check if production database ALREADY EXISTS - if so, DO NOT overwrite!
    if (fs.existsSync(targetDb)) {
      const targetSize = fs.statSync(targetDb).size;
      console.log('✅ Production database already exists!');
      console.log(`   Path: ${targetDb}`);
      console.log(`   Size: ${(targetSize / 1024 / 1024).toFixed(2)} MB`);
      console.log('   Skipping copy to preserve production data.');
      return;
    }

    // Production database doesn't exist - check if we have a source to copy
    if (!fs.existsSync(sourceDb)) {
      console.log('⚠️  No source database found at:', sourceDb);
      console.log('   The application will create a fresh database on startup.');
      return;
    }

    // Copy the seed database to production (first-time setup only)
    console.log('📋 First-time setup: Copying seed database...');
    console.log('   From:', sourceDb);
    console.log('   To:', targetDb);

    fs.copyFileSync(sourceDb, targetDb);

    // Verify the copy
    const sourceSize = fs.statSync(sourceDb).size;
    const targetSize = fs.statSync(targetDb).size;

    if (sourceSize === targetSize) {
      console.log('✅ Seed database deployed successfully!');
      console.log(`   Size: ${(targetSize / 1024 / 1024).toFixed(2)} MB`);
    } else {
      console.error('❌ Database copy verification failed!');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Database deployment check failed:', error.message);
    console.log('   The application will use database initialization instead.');
  }
}

// Run the deployment
deployDatabase();
