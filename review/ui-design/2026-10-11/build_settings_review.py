"""Build S1 review HTML and a static drawing. This does not run the product UI.

Usage: python build_settings_review.py --font /path/to/NotoSansSC.ttf
Font source: https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf
Font license: OFL.txt (review typography only; not approved game lettering).
"""
from pathlib import Path
import argparse, base64, json, re
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from fontTools.ttLib import TTFont as FontToolsFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ASSETS = {
    'PAPER': 'web/assets/gameplay-v4/components/backgrounds/paper-background.png',
    'FRAME': 'web/assets/gameplay-v4/components/panels/status-panel-frame.png',
    'AVATAR': 'web/assets/gameplay-v4/components/controls/avatar-frame.png',
    'TITLE': 'web/assets/menu-v1/title-settings.png',
    'BACK': 'web/assets/menu-v1/icon-back.png',
    'FOOTER': 'web/assets/menu-v1/decoration-footer.png',
    'RESET': 'web/assets/menu-v1/label-reset.png',
}

def html():
    data = json.loads((HERE / 'settings-public-fixtures.json').read_text())
    text = (HERE / 'settings-template.html').read_text()
    for name, path in ASSETS.items():
        b = (ROOT / path).read_bytes()
        text = text.replace('__' + name + '__', 'data:image/png;base64,' + base64.b64encode(b).decode())
    text = text.replace('__MODES__', json.dumps(data['modes'], ensure_ascii=False))
    text = text.replace('__BOARDS__', json.dumps(data['boards'], ensure_ascii=False))
    (HERE / 'settings-s1-prototype.html').write_text(text)

INK, SOFT, PAPER, BLUE, RED = map(HexColor, ['#201b17', '#67594d', '#eee9dd', '#23698c', '#9b2925'])

def pdf(font_path):
    font = FontToolsFont(font_path)
    if 'fvar' in font:
        font = instantiateVariableFont(font, {'wght': 400}, inplace=False)
    font_file = Path('/tmp/lezi-ui-review-noto-static.ttf')
    font.save(font_file)
    pdfmetrics.registerFont(TTFont('ReviewCN', str(font_file)))
    c = canvas.Canvas(str(HERE / 'settings-s1-review.pdf'), pagesize=(1280, 900))
    c.setTitle('乐子象棋 UI-001 / 设置页 S1 待审候选')
    c.setAuthor('乐子象棋独立 UI 设计工作线')
    c.setSubject('静态设计图；非产品运行截图；未批准；不宣称浏览器或设备验收')
    def text(x, top, t, size=16, color=INK):
        c.setFillColor(color); c.setFont('ReviewCN', size); c.drawString(x, 900-top-size, t)
    def wrap(x, top, t, width, size=16, color=INK, line=1.6):
        acc=''; y=top
        for ch in re.findall(r'[A-Za-z0-9_./%-]+|.', t):
            if ch=='\n' or pdfmetrics.stringWidth(acc+ch,'ReviewCN',size)>width:
                text(x,y,acc,size,color); y+=size*line; acc='' if ch=='\n' else ch
            else: acc+=ch
        if acc: text(x,y,acc,size,color); y+=size*line
        return y
    def image(path,x,y,w,h):
        c.drawImage(str(ROOT/path),x,y,w,h,mask='auto')
    def phone(left,top,w,h,scale,large=False):
        c.saveState(); c.translate(left,900-top-h*scale); c.scale(scale,scale)
        c.setFillColor(PAPER);c.rect(0,0,w,h,fill=1,stroke=0)
        image(ASSETS['PAPER'],0,0,w,h)
        c.saveState();c.setFillAlpha(.25);image(ASSETS['FOOTER'],0,0,w,w*467/1400);c.restoreState()
        short=h<=640
        title_w=112 if short else 140;title_h=title_w*240/560
        head_top=16; head_h=88 if short else 144
        image(ASSETS['TITLE'],(w-title_w)/2,h-head_top-(head_h+title_h)/2,title_w,title_h)
        image(ASSETS['BACK'],24,h-56,32,32)
        body_top=112 if short else 160;body_bottom=96 if short else 100
        p=c.beginPath();p.rect(24,body_bottom,w-48,h-body_top-body_bottom);c.saveState();c.clipPath(p,stroke=0,fill=0)
        fs=32 if large else 16; yy=h-body_top
        def pt(x,y,t,s=fs,col=INK):
            c.setFont('ReviewCN',s);c.setFillColor(col);c.drawString(x,y-s,t)
        def lines(x,y,t,width,size):
            line=''
            for ch in t:
                if pdfmetrics.stringWidth(line+ch,'ReviewCN',size)>width:
                    pt(x,y,line,size,SOFT);y-=size*1.65;line=ch
                else:line+=ch
            if line:pt(x,y,line,size,SOFT);y-=size*1.65
            return y
        row_h=96 if large else (64 if short else 72)
        for name,on in [('音效',True),('触感反馈',True),('减少动画',False)]:
            baseline=yy-row_h/2+fs/2
            pt(26,baseline,name,fs if not large else 28)
            # A static drawing of the proposed state text / position pairing.
            state='开启' if on else '关闭';swx=w-78
            pt(swx-40 if not large else 26,baseline if not large else baseline-36,state,14 if not large else 20,BLUE if on else SOFT)
            image(ASSETS['FRAME'],swx,yy-row_h/2-16,52,32)
            image(ASSETS['AVATAR'],swx+(26 if on else 2),yy-row_h/2-12,24,24)
            c.setStrokeColor(HexColor('#a79b8d'));c.setLineWidth(.7);c.line(26,yy-row_h,w-26,yy-row_h)
            yy-=row_h
        yy-=20;pt(26,yy,'游戏模式',fs);yy-=fs+10
        pt(26,yy,'现有揭棋',fs)
        c.setStrokeColor(SOFT);c.setLineWidth(1);c.line(w-44,yy-10,w-40,yy-14);c.line(w-40,yy-14,w-36,yy-10)
        yy-=max(48,fs+16)
        c.setStrokeColor(SOFT);c.line(26,yy,w-26,yy);yy-=12
        yy=lines(26,yy,'双方30枚非将帅全局混洗，揭示后可能倒戈。',w-52,14 if not large else 28)
        yy-=12;pt(26,yy,'查看基础开局',fs,BLUE);yy-=48
        c.setStrokeColor(BLUE);c.line(26,yy,w-26,yy)
        c.restoreState()
        if short:
            c.setFillColor(PAPER);c.rect(24,body_bottom,w-48,16,fill=1,stroke=0)
            c.setFillColor(SOFT);c.setFont('ReviewCN',12);c.drawCentredString(w/2,body_bottom+3,'向下滑动查看更多')
        reset_h=56 if short else 64
        image(ASSETS['FRAME'],24,16,w-48,reset_h)
        reset_w=126 if short else 140
        image(ASSETS['RESET'],(w-reset_w)/2,16+(reset_h-reset_w*180/560)/2,reset_w,reset_w*180/560)
        c.restoreState()
    c.setFillColor(HexColor('#f7f4ed'));c.rect(0,0,1280,900,fill=1,stroke=0)
    text(40,26,'乐子象棋 · 设置页 S1',30)
    text(40,72,'待审候选 / 静态设计图，非运行截图 / 不接入产品',16,RED)
    text(40,114,'390 × 845 · 100% 字体',16,BLUE)
    phone(40,146,390,845,.78)
    text(385,114,'320 × 568 · 短屏结构',16,BLUE)
    phone(385,146,320,568,.88)
    text(704,114,'差分与边界',19)
    y=154
    notes=[
        ('01  保留现有功能','三项本机偏好、三模式选择、基础开局预览和恢复默认全部保留。恢复默认仍含游戏模式。'),
        ('02  同时显示状态文字','开关以“开启／关闭”及位置共同表达，整行可点；48px是候选CSS目标，设备dp尚未测量。'),
        ('03  内容区独立滚动','标题、返回与恢复默认固定。短屏缩减顶部留白；大字体保留全部内容，允许设置内容滚动。'),
        ('04  保留模式资格门禁','半混乱／普通象棋保留“完整对局暂未开放”说明。预览仅展示公开开局，不进入对局。'),
        ('05  原资产保持不变','标题、返回、恢复默认、山水复用menu-v1候选；宣纸及墨框复用既存组件。首页、棋盘及交点无变化。'),
        ('06  尚未验收','HTML原型已提供；本轮浏览器缺失。运行对照、200%字体、焦点及Android设备验证仍待执行。'),
    ]
    for title,body in notes:
        text(704,y,title,16,BLUE);y=wrap(704,y+28,body,522,16)+20
    text(385,670,'大字体处理',18,BLUE)
    wrap(385,705,'150%／200%不裁掉条目；在HTML原型切换倍率，滚动设置内容。设计目标尚需运行验证。',260,15)
    text(40,840,'基线 ac8c25c4addd · UI-001清单完成 / UI-002设置候选待审 / Δ规则=0 / 正式评分冻结',13,SOFT)
    text(40,866,'复用资产保持原字节；静态图与HTML分别构建，本图不能作为HTML运行效果证据。',12,SOFT)
    c.showPage();c.save()

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--font',required=True);a=p.parse_args()
    html();pdf(a.font)
