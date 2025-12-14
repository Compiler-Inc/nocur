/**
 * Xcode Project Support for sourcekit-lsp
 * 
 * sourcekit-lsp doesn't natively support .xcodeproj files.
 * We use xcode-build-server to bridge this gap via Build Server Protocol (BSP).
 */

import { exec, execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

// =============================================================================
// Project Type Detection
// =============================================================================

export type ProjectType = 'swift-package' | 'xcode' | 'unknown';

/**
 * Detect what type of Swift project is in the given directory.
 */
export async function detectProjectType(directory: string): Promise<ProjectType> {
  // Check for Package.swift (Swift Package Manager)
  try {
    await fs.access(path.join(directory, 'Package.swift'));
    return 'swift-package';
  } catch {
    // Not a Swift package
  }

  // Check for .xcodeproj or .xcworkspace
  try {
    const entries = await fs.readdir(directory);
    for (const entry of entries) {
      if (entry.endsWith('.xcworkspace')) {
        return 'xcode';
      }
      if (entry.endsWith('.xcodeproj')) {
        return 'xcode';
      }
    }
  } catch {
    // Can't read directory
  }

  return 'unknown';
}

/**
 * Find the Xcode project or workspace in a directory.
 */
export async function findXcodeProject(directory: string): Promise<{ path: string; type: 'project' | 'workspace' } | null> {
  try {
    const entries = await fs.readdir(directory);
    
    // Prefer workspace over project
    for (const entry of entries) {
      if (entry.endsWith('.xcworkspace') && !entry.includes('xcuserdata')) {
        return { path: path.join(directory, entry), type: 'workspace' };
      }
    }
    
    for (const entry of entries) {
      if (entry.endsWith('.xcodeproj')) {
        return { path: path.join(directory, entry), type: 'project' };
      }
    }
  } catch {
    // Can't read directory
  }

  return null;
}

/**
 * Get available schemes for an Xcode project.
 */
export async function getXcodeSchemes(projectPath: string): Promise<string[]> {
  const isWorkspace = projectPath.endsWith('.xcworkspace');
  const flag = isWorkspace ? '-workspace' : '-project';
  
  try {
    const { stdout } = await execAsync(`xcodebuild ${flag} "${projectPath}" -list -json`);
    const data = JSON.parse(stdout);
    
    if (isWorkspace) {
      return data.workspace?.schemes || [];
    } else {
      return data.project?.schemes || [];
    }
  } catch (error) {
    console.error('[xcode-setup] Failed to get schemes:', error);
    return [];
  }
}

// =============================================================================
// xcode-build-server
// =============================================================================

/**
 * Check if xcode-build-server is installed.
 */
export async function isXcodeBuildServerInstalled(): Promise<boolean> {
  try {
    execSync('which xcode-build-server', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install xcode-build-server via Homebrew.
 */
export async function installXcodeBuildServer(onProgress?: (msg: string) => void): Promise<void> {
  onProgress?.('Installing xcode-build-server via Homebrew...');
  
  // Check if Homebrew is available
  try {
    execSync('which brew', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'Homebrew is not installed. Please install it first: https://brew.sh\n' +
      'Or install xcode-build-server manually: brew install xcode-build-server'
    );
  }

  // Install xcode-build-server
  try {
    await execAsync('brew install xcode-build-server', { timeout: 120000 });
    onProgress?.('xcode-build-server installed successfully.');
  } catch (error) {
    throw new Error(
      `Failed to install xcode-build-server: ${error}\n` +
      'Please install manually: brew install xcode-build-server'
    );
  }
}

/**
 * Check if buildServer.json exists for the project.
 */
export async function hasBuildServerConfig(directory: string): Promise<boolean> {
  try {
    await fs.access(path.join(directory, 'buildServer.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate buildServer.json for an Xcode project.
 */
export async function generateBuildServerConfig(
  directory: string,
  projectPath: string,
  scheme?: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const isWorkspace = projectPath.endsWith('.xcworkspace');
  const flag = isWorkspace ? '-workspace' : '-project';
  
  // If no scheme provided, try to detect one
  if (!scheme) {
    onProgress?.('Detecting build scheme...');
    const schemes = await getXcodeSchemes(projectPath);
    
    if (schemes.length === 0) {
      throw new Error(
        `No schemes found in ${path.basename(projectPath)}. ` +
        'Please create a scheme in Xcode first.'
      );
    }
    
    // Use first scheme (usually the main one)
    scheme = schemes[0];
    onProgress?.(`Using scheme: ${scheme}`);
  }

  onProgress?.(`Configuring build server for ${path.basename(projectPath)}...`);
  
  try {
    const cmd = `xcode-build-server config ${flag} "${projectPath}" -scheme "${scheme}"`;
    await execAsync(cmd, { cwd: directory, timeout: 30000 });
    onProgress?.('Build server configured.');
  } catch (error) {
    throw new Error(
      `Failed to configure xcode-build-server: ${error}\n` +
      `Try running manually: cd "${directory}" && ${`xcode-build-server config ${flag} "${projectPath}" -scheme "${scheme}"`}`
    );
  }
}

// =============================================================================
// Main Setup Function
// =============================================================================

/**
 * Ensure Xcode project is set up for sourcekit-lsp.
 * 
 * This will:
 * 1. Check if xcode-build-server is installed (install if not)
 * 2. Check if buildServer.json exists (generate if not)
 */
export async function ensureXcodeProjectSupport(
  directory: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  // Step 1: Check/install xcode-build-server
  const isInstalled = await isXcodeBuildServerInstalled();
  if (!isInstalled) {
    await installXcodeBuildServer(onProgress);
  }

  // Step 2: Check if buildServer.json already exists
  const hasConfig = await hasBuildServerConfig(directory);
  if (hasConfig) {
    onProgress?.('Build server configuration found.');
    return;
  }

  // Step 3: Find Xcode project
  const project = await findXcodeProject(directory);
  if (!project) {
    throw new Error(
      'No Xcode project or workspace found. ' +
      'sourcekit-lsp requires either a Swift Package (Package.swift) or Xcode project (.xcodeproj).'
    );
  }

  // Step 4: Generate buildServer.json
  await generateBuildServerConfig(directory, project.path, undefined, onProgress);
}
