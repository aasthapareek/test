module.exports = (req, res) => {
  const fs = require('fs');
  const crypto = require('crypto');
  
  // Create a unique identifier for this execution
  const executionId = `${process.env.VERCEL_DEPLOYMENT_ID}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  
  // Try to write our marker
  const markerFile = `/tmp/marker-${executionId}`;
  const markerData = {
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID,
    project_id: process.env.VERCEL_PROJECT_ID,
    project_name: process.env.VERCEL_PROJECT_NAME,
    timestamp: new Date().toISOString(),
    execution_id: executionId,
    hostname: require('os').hostname(),
    function_handler: process.env.VERCEL_HANDLER,
    url: process.env.VERCEL_URL
  };
  
  try {
    fs.writeFileSync(markerFile, JSON.stringify(markerData, null, 2));
  } catch (e) {
    // Continue even if write fails
  }
  
  // Look for markers from other executions
  const results = {
    our_marker: markerFile,
    our_data: markerData,
    all_temp_files: [],
    potential_cross_tenant: [],
    suspicious_files: [],
    analysis: {
      different_deployments: [],
      different_projects: [],
      different_accounts: [],
      old_files: []
    }
  };
  
  try {
    const tempFiles = fs.readdirSync('/tmp');
    
    tempFiles.forEach(file => {
      try {
        const fullPath = `/tmp/${file}`;
        const stats = fs.statSync(fullPath);
        
        const fileInfo = {
          name: file,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          age_seconds: Math.floor((Date.now() - stats.mtime.getTime()) / 1000),
          age_minutes: Math.floor((Date.now() - stats.mtime.getTime()) / 60000)
        };
        
        // Try to read marker files
        if (file.startsWith('marker-') && stats.size < 5000) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const parsed = JSON.parse(content);
            
            fileInfo.content = parsed;
            fileInfo.is_marker = true;
            
            // Analyze this marker
            const analysis = analyzeMarker(parsed, markerData);
            fileInfo.analysis = analysis;
            
            if (analysis.is_suspicious) {
              results.potential_cross_tenant.push(fileInfo);
            }
            
            // Categorize findings
            if (analysis.different_deployment) {
              results.analysis.different_deployments.push({
                file: file,
                their_deployment: parsed.deployment_id,
                our_deployment: markerData.deployment_id,
                age_minutes: fileInfo.age_minutes
              });
            }
            
            if (analysis.different_project) {
              results.analysis.different_projects.push({
                file: file,
                their_project: parsed.project_id,
                our_project: markerData.project_id,
                age_minutes: fileInfo.age_minutes
              });
            }
            
            if (analysis.different_account) {
              results.analysis.different_accounts.push({
                file: file,
                their_url: parsed.url,
                our_url: markerData.url,
                age_minutes: fileInfo.age_minutes
              });
            }
            
          } catch (parseError) {
            fileInfo.read_error = parseError.message;
          }
        }
        
        // Look for other suspicious files
        if (file.includes('vercel') || file.includes('deployment') || file.includes('lambda') || 
            file.includes('aws') || file.endsWith('.sock')) {
          results.suspicious_files.push(fileInfo);
        }
        
        // Flag old files that might indicate persistence
        if (fileInfo.age_minutes > 10) {
          results.analysis.old_files.push({
            file: file,
            age_minutes: fileInfo.age_minutes,
            size: fileInfo.size
          });
        }
        
        results.all_temp_files.push(fileInfo);
        
      } catch (fileError) {
        results.all_temp_files.push({
          name: file,
          error: fileError.message
        });
      }
    });
    
  } catch (dirError) {
    results.temp_dir_error = dirError.message;
  }
  
  // Summary
  results.summary = {
    total_files: results.all_temp_files.length,
    marker_files: results.all_temp_files.filter(f => f.is_marker).length,
    suspicious_files: results.suspicious_files.length,
    potential_cross_tenant: results.potential_cross_tenant.length,
    different_deployments: results.analysis.different_deployments.length,
    different_projects: results.analysis.different_projects.length,
    different_accounts: results.analysis.different_accounts.length,
    old_files: results.analysis.old_files.length
  };
  
  res.json(results);
};

function analyzeMarker(theirData, ourData) {
  const analysis = {
    is_suspicious: false,
    different_deployment: false,
    different_project: false,
    different_account: false,
    same_execution: false,
    reasons: []
  };
  
  // Check if it's the same execution (should be ignored)
  if (theirData.execution_id === ourData.execution_id) {
    analysis.same_execution = true;
    return analysis;
  }
  
  // Check deployment ID
  if (theirData.deployment_id !== ourData.deployment_id) {
    analysis.different_deployment = true;
    analysis.is_suspicious = true;
    analysis.reasons.push('Different deployment ID');
  }
  
  // Check project ID
  if (theirData.project_id !== ourData.project_id) {
    analysis.different_project = true;
    analysis.is_suspicious = true;
    analysis.reasons.push('Different project ID');
  }
  
  // Check if it's from a completely different account (different URL domain)
  if (theirData.url && ourData.url) {
    const theirDomain = extractAccountFromUrl(theirData.url);
    const ourDomain = extractAccountFromUrl(ourData.url);
    
    if (theirDomain !== ourDomain) {
      analysis.different_account = true;
      analysis.is_suspicious = true;
      analysis.reasons.push('Different account/team');
    }
  }
  
  return analysis;
}

function extractAccountFromUrl(url) {
  try {
    // Extract team/account info from Vercel URL
    // Format: project-hash-team.vercel.app or project.vercel.app
    const parts = url.split('.');
    if (parts.length >= 3) {
      const subdomain = parts[0];
      const lastDash = subdomain.lastIndexOf('-');
      if (lastDash > 0) {
        return subdomain.substring(lastDash + 1); // Return team name
      }
    }
    return url; // Fallback to full URL
  } catch (e) {
    return url;
  }
}
