"""
Nexus DynamicIsland 外部通知客户端

用法：
    python python_notify.py "标题" "消息内容"
    python python_notify.py "构建完成" "编译成功" success

或直接导入使用：
    from python_notify import notify
    notify("标题", "消息内容", "info")
"""

import socket
import json
import os
import sys
from pathlib import Path


def get_socket_path() -> str:
    """获取 Nexus UDS socket 路径"""
    if os.name == 'nt':
        return r'\\.\pipe\tview-notify'
    return str(Path.home() / '.config' / 'tview' / 'notify.sock')


def notify(
    title: str,
    message: str = "",
    msg_type: str = 'info',
    duration: int | None = None,
    icon: str | None = None,
) -> bool:
    """
    向 Nexus 灵动岛发送一条消息。

    :param title: 消息标题（必填）
    :param message: 消息内容
    :param msg_type: 'info' | 'success' | 'warning' | 'error'
    :param duration: 显示时长（毫秒），默认自动
    :param icon: 自定义图标字符
    :return: 发送是否成功
    """
    valid_types = {'info', 'success', 'warning', 'error'}
    if msg_type not in valid_types:
        msg_type = 'info'

    payload = {
        'title': title,
        'message': message,
        'type': msg_type,
    }
    if duration is not None:
        payload['duration'] = duration
    if icon is not None:
        payload['icon'] = icon

    sock_path = get_socket_path()

    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(sock_path)
        sock.sendall((json.dumps(payload, ensure_ascii=False) + '\n').encode('utf-8'))
        sock.close()
        return True
    except (ConnectionRefusedError, FileNotFoundError):
        print(f'Nexus 未运行或 UDS 未启动 (socket: {sock_path})', file=sys.stderr)
        return False
    except Exception as e:
        print(f'发送失败: {e}', file=sys.stderr)
        return False


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(f'用法: {sys.argv[0]} <title> [message] [type]')
        print(f'  type: info (默认) | success | warning | error')
        sys.exit(1)

    title = sys.argv[1]
    message = sys.argv[2] if len(sys.argv) > 2 else ''
    msg_type = sys.argv[3] if len(sys.argv) > 3 else 'info'

    if notify(title, message, msg_type):
        print('消息已发送')
    else:
        sys.exit(1)
