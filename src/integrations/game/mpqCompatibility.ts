/** Public launcher compatibility only; contains no upstream Toolkit/DLL source. */
export const gameMpqCompatibilityBootstrap = String.raw`
import os
import runpy
import subprocess
import sys
from pathlib import Path

def normalize_mpq_read_arguments(arguments):
    if isinstance(arguments, (list, tuple)) and len(arguments) >= 4:
        executable = os.path.basename(os.fspath(arguments[0])).lower()
        if executable in ('mpqcli', 'mpqcli.exe') and arguments[1] == 'read' and isinstance(arguments[2], str):
            normalized = list(arguments)
            normalized[2] = normalized[2].replace('/', '\\')
            return normalized
    return arguments

def main():
    server = Path(sys.argv[1]).resolve(strict=True)
    original_check_output = subprocess.check_output
    def read_compatible(arguments, *args, **kwargs):
        return original_check_output(normalize_mpq_read_arguments(arguments), *args, **kwargs)
    subprocess.check_output = read_compatible
    sys.argv = sys.argv[1:]
    sys.path.insert(0, str(server.parent))
    runpy.run_path(str(server), run_name='__main__')

if __name__ == '__main__':
    main()
`;
