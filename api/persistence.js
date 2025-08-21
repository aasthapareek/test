module.exports = (req, res) => {
  const fs = require('fs');
  const crypto = require('crypto');
  
  const timestamp = new Date().toISOString();
  const uniqueId = crypto.randomBytes(16).toString('hex');
  
  // Create our persistence marker
  const persistenceMarker = {
    created: timestamp,
    unique_id: uniqueId,
    deployment: process.env.VERCEL_DEPLOYMENT_ID,
    project: process.env.VERCEL_PROJECT_ID,
    cold_start_test: true
  };
  
  const markerFile = `/tmp/persistence-${uniqueId}`;
  
  try {
    fs.writeFileSync(markerFile, JSON.stringify(persistenceMarker, null, 2));
  } catch (e) {
    // Continue
  }
  
  // Check for any old persistence markers
  const results = {
    our_marker: persistenceMarker,
    old_persistence_markers: [],
    all_files: [],
    environment_info: {
      container_start_time: getContainerStartTime(),
      process_uptime: process.uptime(),
      hostname: require('os').hostname()
    }
  };
  
  try {
    const files = fs.readdirSync('/tmp');
    
    files.forEach(file => {
      const fullPath = `/tmp/${file}`;
      const stats = fs.statSync(fullPath);
      
      const fileInfo = {
        name: file,
        age_minutes: Math.floor((Date.now() - stats.mtime.getTime()) / 60000),
        size: stats.size
      };
      
      // Look for old persistence markers
      if (file.startsWith('persistence-')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const data = JSON.parse(content);
          
          // If this marker is from a previous execution (different unique_id)
          if (data.unique_id !== uniqueId) {
            results.old_persistence_markers.push({
              ...fileInfo,
              content: data,
              is_from_same_deployment: data.deployment === process.env.VERCEL_DEPLOYMENT_ID,
              is_from_same_project: data.project === process.env.VERCEL_PROJECT_ID
            });
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
      
      results.all_files.push(fileInfo);
    });
    
  } catch (e) {
    results.scan_error = e.message;
  }
  
  results.summary = {
    found_old_markers: results.old_persistence_markers.length,
    cross_deployment_markers: results.old_persistence_markers.filter(m => !m.is_from_same_deployment).length,
    cross_project_markers: results.old_persistence_markers.filter(m => !m.is_from_same_project).length
  };
  
  res.json(results);
};

function getContainerStartTime() {
  try {
    const fs = require('fs');
    const bootTime = fs.readFileSync('/proc/stat', 'utf8')
      .split('\n')
      .find(line => line.startsWith('btime'))
      .split(' ')[1];
    return new Date(parseInt(bootTime) * 1000).toISOString();
  } catch (e) {
    return 'Unknown';
  }
}
