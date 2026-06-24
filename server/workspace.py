import os
import subprocess
import sys

from . import config


def _choose_directory_tk(initial_dir):
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes('-topmost', True)
    except Exception:
        pass
    try:
        return filedialog.askdirectory(
            parent=root,
            title='Select sandbox folder',
            initialdir=initial_dir if os.path.isdir(initial_dir) else config.WORKSPACE_ROOT,
            mustexist=True
        ) or ''
    finally:
        try:
            root.destroy()
        except Exception:
            pass


def _choose_directory_powershell(initial_dir):
    if sys.platform != 'win32':
        raise RuntimeError('PowerShell folder picker is only available on Windows.')

    script = r"""
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$initial = [Console]::In.ReadToEnd().Trim()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select sandbox folder'
$dialog.ShowNewFolderButton = $true
if ($initial -and (Test-Path -LiteralPath $initial -PathType Container)) {
    $dialog.SelectedPath = $initial
}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
}
"""
    proc = subprocess.run(
        ['powershell', '-NoProfile', '-STA', '-Command', script],
        input=initial_dir or '',
        text=True,
        encoding='utf-8',
        errors='replace',
        capture_output=True
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or '').strip()
        raise RuntimeError(err or f'PowerShell exited with {proc.returncode}')
    return (proc.stdout or '').strip().splitlines()[0] if (proc.stdout or '').strip() else ''


def choose_directory(initial_dir=''):
    initial = os.path.realpath(os.path.expanduser(initial_dir or config.WORKSPACE_ROOT))
    errors = []
    try:
        return _choose_directory_tk(initial)
    except Exception as e:
        errors.append(f'tkinter: {e}')
    if sys.platform == 'win32':
        try:
            return _choose_directory_powershell(initial)
        except Exception as e:
            errors.append(f'powershell: {e}')
    raise RuntimeError('Cannot open folder picker: ' + '; '.join(errors))


class WorkspaceMixin:
    def _apply_workspace(self, path):
        raw = str(path or '').strip().strip('"')
        if not raw:
            return self._send_json(200, {
                'ok': False,
                'cancelled': True,
                'error': 'No folder selected.',
                'workspace': config.WORKSPACE_ROOT,
                'cwd': config.get_current_cwd()
            })

        try:
            config.set_workspace(raw)
        except FileNotFoundError as e:
            return self._send_json(200, {'ok': False, 'error': str(e)})
        except Exception as e:
            return self._send_json(500, {'ok': False, 'error': f'Failed to set workspace: {e}'})

        workspace = config.WORKSPACE_ROOT
        return self._send_json(200, {
            'ok': True,
            'workspace': workspace,
            'cwd': workspace
        })

    def handle_set_workspace(self, body):
        return self._apply_workspace(body.get('path') or body.get('workspace') or '')

    def handle_select_workspace(self, body):
        initial = body.get('initial_dir') or config.WORKSPACE_ROOT
        try:
            selected = choose_directory(initial)
        except Exception as e:
            return self._send_json(500, {
                'ok': False,
                'error': str(e),
                'platform': sys.platform
            })
        if not selected:
            return self._send_json(200, {
                'ok': False,
                'cancelled': True,
                'error': 'Folder selection cancelled.',
                'workspace': config.WORKSPACE_ROOT,
                'cwd': config.get_current_cwd()
            })
        return self._apply_workspace(selected)
