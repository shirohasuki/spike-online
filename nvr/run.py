#!/usr/bin/env python3
"""
RISC-V Spike + BuckyBall 性能分析工具
"""

import os
import sys
import subprocess
import argparse
import yaml
import json
from pathlib import Path

# 获取脚本所在目录的绝对路径
SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_ROOT = SCRIPT_DIR.parent
BUILD_DIR = PROJECT_ROOT / "build"
BUCKYBALL_DIR = SCRIPT_DIR / "buckyball"
SCRIPTS_DIR = SCRIPT_DIR / "scripts"
CONFIG_FILE = SCRIPT_DIR / "config.yaml"

def load_config():
    """加载配置文件"""
    # 尝试新的配置文件
    new_config_file = SCRIPT_DIR / "buckyballConfig.json"
    if new_config_file.exists():
        try:
            with open(new_config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # 转换为run.py期望的格式
                return {
                    'paths': {
                        'binary': 'binary',
                        'output': 'output'
                    },
                    'filenames': {
                        'profile_json': 'profile.json',
                        'profile_csv': 'profile.csv', 
                        'profile_html': 'profile.html'
                    }
                }
        except Exception as e:
            print(f"配置文件格式错误: {e}")
            sys.exit(1)
    
    # 如果新配置文件不存在，尝试旧的config.yaml
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    except:
        print(f"找不到配置文件: {CONFIG_FILE} 或 {new_config_file}")
        sys.exit(1)

def run_command(cmd, **kwargs):
    """执行命令并打印"""
    if isinstance(cmd, list):
        print(f"执行: {' '.join(cmd)}")
    else:
        print(f"执行: {cmd}")
    return subprocess.run(cmd, **kwargs)

def build_buckyball():
    """编译BuckyBall扩展"""
    print("编译BuckyBall扩展...")
    
    build_dir = BUCKYBALL_DIR / "build"
    
    try:
        build_dir.mkdir(exist_ok=True)
        print(f"切换到目录: {build_dir}")
        os.chdir(build_dir)
        
        run_command(["cmake", ".."], capture_output=True, check=True)
        run_command(["make", "-j256"], capture_output=True, check=True)
        run_command(["make", "install"], capture_output=True, check=True)
        
        print("BuckyBall扩展编译完成")
        return True
        
    except Exception as e:
        print(f"BuckyBall编译失败: {e}")
        return False

def build_spike():
    """编译Spike仿真器"""
    print("编译Spike仿真器...")
    
    try:
        print(f"切换到目录: {BUILD_DIR}")
        os.chdir(BUILD_DIR)
        run_command(["../configure", "--prefix=$RISCV"], capture_output=True, check=True)
        run_command(["sudo", "make", "install", "-j256"], capture_output=True, check=True)
        print("Spike仿真器编译完成")
        return True
        
    except Exception as e:
        print(f"Spike编译失败: {e}")
        return False

def run_spike(workload_path, output_dir, config):
    """运行Spike仿真"""
    print(f"运行Spike仿真: {workload_path}")
    
    # 转换为绝对路径
    workload_path = Path(workload_path).absolute()
    output_dir = Path(output_dir).absolute()
    output_dir.mkdir(exist_ok=True)
    
    spike_binary = str(BUILD_DIR / "spike")
    cmd = [str(spike_binary), "--extension=buckyballFunc", str(workload_path)]
    
    # 设置缓存配置文件环境变量
    env = os.environ.copy()
    env['SPIKE_CONFIG_PATH'] = str(SCRIPT_DIR / "config.yaml")
    
    try:
        result = run_command(cmd, capture_output=True, text=True, env=env)
        if result.returncode == 0:
            # 移动性能文件到输出目录，使用简化的文件名
            old_filename = "profile0.json"
            new_filename = config['filenames']['profile_json']
            
            src_file = Path(old_filename)
            if src_file.exists():
                dst_file = output_dir / new_filename
                print(f"移动文件: {src_file} -> {dst_file}")
                src_file.rename(dst_file)
            print("Spike仿真完成")
            return True
        else:
            print(f"Spike仿真失败: {result.stderr}")
            return False
    except Exception as e:
        print(f"运行Spike时出错: {e}")
        return False

def generate_csv(output_dir, workload_path, config):
    """生成CSV分析文件"""
    print("生成CSV分析文件...")
    
    output_dir = Path(output_dir).absolute()
    workload_path = Path(workload_path).absolute()
    
    try:
        profile_file = output_dir / config['filenames']['profile_json']
        csvgen_script = SCRIPTS_DIR / "csvGen.py"
        cmd = ["python3", str(csvgen_script), str(profile_file), str(workload_path)]
        
        result = run_command(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            # 重命名生成的CSV文件
            old_csv = output_dir / "profile_analyzed.csv"  # csvGen.py生成的文件名
            new_csv = output_dir / config['filenames']['profile_csv']
            if old_csv.exists():
                print(f"重命名文件: {old_csv} -> {new_csv}")
                old_csv.rename(new_csv)
            print("CSV文件生成完成")
            return True
        else:
            print(f"CSV生成失败，退出码: {result.returncode}")
            if result.stdout:
                print(f"stdout: {result.stdout}")
            if result.stderr:
                print(f"stderr: {result.stderr}")
            return False
    except Exception as e:
        print(f"生成CSV时出错: {e}")
        return False

def generate_html(output_dir, workload_path, config):
    """生成HTML报告（反汇编 + 性能数据）"""
    print("生成HTML反汇编报告...")
    
    output_dir = Path(output_dir).absolute()
    workload_path = Path(workload_path).absolute()
    
    try:
        csv_file = output_dir / config['filenames']['profile_csv']
        htmlgen_script = SCRIPTS_DIR / "htmlGen.py"
        
        # htmlGen.py需要binary文件获取完整反汇编，CSV文件提供性能数据
        cmd = ["python3", str(htmlgen_script), str(workload_path), str(csv_file)]
        
        result = run_command(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            # htmlGen.py生成的文件名格式为: {binary_name}_disasm_report.html
            binary_name = workload_path.stem
            old_html = Path(f"{binary_name}_disasm_report.html")
            new_html = output_dir / config['filenames']['profile_html']
            
            if old_html.exists():
                print(f"移动文件: {old_html} -> {new_html}")
                old_html.rename(new_html)
            print("HTML反汇编报告生成完成")
            return True
        else:
            print(f"HTML生成失败，退出码: {result.returncode}")
            if result.stdout:
                print(f"stdout: {result.stdout}")
            if result.stderr:
                print(f"stderr: {result.stderr}")
            return False
    except Exception as e:
        print(f"HTML生成失败: {e}")
        return False

def main():
    # 加载配置
    config = load_config()
    
    parser = argparse.ArgumentParser(description="RISC-V Spike + BuckyBall 性能分析工具")
    parser.add_argument("workload", nargs='?', help="工作负载文件路径")
    parser.add_argument("-o", "--output", help="输出目录")
    
    args = parser.parse_args()
    
    # 在切换目录前，先解析工作负载路径
    if args.workload:
        workload_path = Path(args.workload).absolute()
        if not workload_path.exists():
            print(f"找不到工作负载文件: {args.workload}")
            sys.exit(1)
    else:
        # 如果没有指定workload，列出可用的工作负载
        binary_dir = SCRIPT_DIR / config['paths']['binary']
        if binary_dir.exists():
            workloads = list(binary_dir.glob("*"))
            if workloads:
                print("可用的工作负载:")
                for w in workloads:
                    if w.is_file():
                        print(f"  {w.name}")
                sys.exit(0)
        print("请指定工作负载文件")
        sys.exit(1)
    
    # 现在切换到nvr目录
    os.chdir(SCRIPT_DIR)
    
    # 使用配置文件中的默认输出路径（相对于nvr目录）
    if args.output:
        output_dir = Path(args.output).absolute()
    else:
        output_dir = SCRIPT_DIR / config['paths']['output']

    
    print(f"当前工作目录: {os.getcwd()}")
    print(f"工作负载文件: {workload_path}")
    print(f"输出目录: {Path(output_dir).absolute()}")
    print()
    
    # 执行5步流程
    if not build_buckyball():
        sys.exit(1)
    if not build_spike():
        sys.exit(1)
    if not run_spike(workload_path, output_dir, config):
        sys.exit(1)
    if not generate_csv(output_dir, workload_path, config):
        sys.exit(1)
    generate_html(output_dir, workload_path, config)
    
    print(f"分析完成，结果保存在: {Path(output_dir).absolute()}")
    print(f"生成的文件:")
    print(f"  {config['filenames']['profile_json']} - 性能数据JSON")
    print(f"  {config['filenames']['profile_csv']} - 性能数据CSV") 
    print(f"  {config['filenames']['profile_html']} - 反汇编+性能分析HTML报告")

if __name__ == "__main__":
    main() 