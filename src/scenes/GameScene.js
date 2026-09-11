import Phaser from 'phaser';

const WIDTH = 480;
const HEIGHT = 640;

const PLAYER_SPEED = 320;
const PLAYER_FIRE_COOLDOWN = 280;
const PLAYER_BULLET_SPEED = 520;
const ENEMY_BULLET_SPEED = 260;

const FORMATION_ROWS = 4;
const FORMATION_COLS = 7;
const FORMATION_TOP = 90;
const FORMATION_LEFT = 60;
const FORMATION_SPACING_X = 52;
const FORMATION_SPACING_Y = 46;

const DIVE_MIN_DELAY = 900;
const DIVE_MAX_DELAY = 2200;
const DIVE_DURATION = 2600;

const ENEMY_TYPES = {
  boss: { color: 0xf5c518, accent: 0xfff3b0, score: 150, w: 36, h: 34 },
  blue: { color: 0x4aa3ff, accent: 0xdcf1ff, score: 50, w: 28, h: 26 },
  red: { color: 0xe74c3c, accent: 0xffd9d2, score: 60, w: 28, h: 26 },
};

function rowType(row) {
  if (row === 0) return 'boss';
  return row % 2 === 0 ? 'blue' : 'red';
}

function darken(color, amount) {
  const c = Phaser.Display.Color.ValueToColor(color);
  return Phaser.Display.Color.GetColor(
    Math.round(c.red * (1 - amount)),
    Math.round(c.green * (1 - amount)),
    Math.round(c.blue * (1 - amount))
  );
}

// Draws an insectoid ship silhouette (swept wings + body + glowing eye) into
// the given Graphics object, sized to fill a w x h texture canvas.
function drawEnemyShip(g, cfg, isBoss) {
  const w = cfg.w;
  const h = cfg.h;
  const cx = w / 2;

  g.fillStyle(darken(cfg.color, 0.35), 1);
  g.beginPath();
  g.moveTo(cx, h * 0.35);
  g.lineTo(0, h * 0.1);
  g.lineTo(w * 0.16, h);
  g.lineTo(cx, h * 0.62);
  g.closePath();
  g.fillPath();
  g.beginPath();
  g.moveTo(cx, h * 0.35);
  g.lineTo(w, h * 0.1);
  g.lineTo(w * 0.84, h);
  g.lineTo(cx, h * 0.62);
  g.closePath();
  g.fillPath();

  g.fillStyle(cfg.color, 1);
  g.beginPath();
  g.moveTo(cx, 0);
  g.lineTo(w * 0.74, h * 0.5);
  g.lineTo(cx, h * 0.9);
  g.lineTo(w * 0.26, h * 0.5);
  g.closePath();
  g.fillPath();

  if (isBoss) {
    g.fillStyle(cfg.color, 1);
    g.fillTriangle(cx - w * 0.3, h * 0.16, cx - w * 0.12, 0, cx - w * 0.02, h * 0.18);
    g.fillTriangle(cx + w * 0.3, h * 0.16, cx + w * 0.12, 0, cx + w * 0.02, h * 0.18);
  }

  g.fillStyle(cfg.accent, 1);
  g.fillCircle(cx, h * 0.4, w * 0.15);
}

// Cubic bezier through 4 control points, used for the dive-and-loop path.
function samplePath(points, t) {
  const [p0, p1, p2, p3] = points;
  const u = 1 - t;
  const x = u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x;
  const y = u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y;
  return { x, y };
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init() {
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.fireTimer = 0;
    this.diveTimer = Phaser.Math.Between(DIVE_MIN_DELAY, DIVE_MAX_DELAY);
    this.enemies = [];
    this.gameOver = false;
    this.invulnUntil = 0;
  }

  preload() {
    this.generateTextures();
  }

  create() {
    this.physics.world.setBounds(0, 0, WIDTH, HEIGHT);
    this.stars = this.add.tileSprite(0, 0, WIDTH, HEIGHT, 'stars').setOrigin(0, 0);

    this.player = this.physics.add.sprite(WIDTH / 2, HEIGHT - 60, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(14, 32).setOffset(13, 2);

    this.playerBullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.enemyGroup = this.physics.add.group();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('A,D');
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.scoreText = this.add.text(10, 8, 'SCORE 0', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' });
    this.livesText = this.add
      .text(WIDTH - 10, 8, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' })
      .setOrigin(1, 0);
    this.waveText = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 60, '', { fontFamily: 'monospace', fontSize: '28px', color: '#f5c518' })
      .setOrigin(0.5);

    this.physics.add.overlap(this.playerBullets, this.enemyGroup, (bullet, enemySprite) =>
      this.onBulletHitEnemy(bullet, enemySprite)
    );
    this.physics.add.overlap(this.player, this.enemyBullets, (player, bullet) => this.onPlayerHitByBullet(bullet));
    this.physics.add.overlap(this.player, this.enemyGroup, (player, enemySprite) => this.onPlayerCollideEnemy(enemySprite));

    this.updateLivesText();
    this.startWave();
  }

  generateTextures() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });

    // starfield background
    g.fillStyle(0x05060a, 1);
    g.fillRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle(0xffffff, 1);
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * WIDTH;
      const y = Math.random() * HEIGHT;
      const s = Math.random() < 0.8 ? 1 : 2;
      g.fillRect(x, y, s, s);
    }
    g.generateTexture('stars', WIDTH, HEIGHT);
    g.clear();

    // player fighter jet (nose up)
    g.fillStyle(0xff8a3d, 1);
    g.fillTriangle(20, 44, 14, 33, 26, 33);
    g.fillStyle(0x2f6fb0, 1);
    g.beginPath();
    g.moveTo(20, 13);
    g.lineTo(2, 33);
    g.lineTo(11, 33);
    g.lineTo(20, 21);
    g.closePath();
    g.fillPath();
    g.beginPath();
    g.moveTo(20, 13);
    g.lineTo(38, 33);
    g.lineTo(29, 33);
    g.lineTo(20, 21);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x53d0ff, 1);
    g.beginPath();
    g.moveTo(20, 0);
    g.lineTo(26, 18);
    g.lineTo(24, 35);
    g.lineTo(16, 35);
    g.lineTo(14, 18);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x0d2b3d, 1);
    g.fillEllipse(20, 12, 6, 10);
    g.fillStyle(0xff5555, 1);
    g.fillCircle(4, 32, 2);
    g.fillStyle(0x55ff77, 1);
    g.fillCircle(36, 32, 2);
    g.generateTexture('player', 40, 44);
    g.clear();

    // player bullet
    g.fillStyle(0x9be8ff, 1);
    g.fillRect(0, 0, 4, 14);
    g.generateTexture('playerBullet', 4, 14);
    g.clear();

    // enemy bullet
    g.fillStyle(0xff5555, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('enemyBullet', 8, 8);
    g.clear();

    for (const [key, cfg] of Object.entries(ENEMY_TYPES)) {
      g.clear();
      drawEnemyShip(g, cfg, key === 'boss');
      g.generateTexture(`enemy_${key}`, cfg.w, cfg.h);
    }

    g.destroy();
  }

  startWave() {
    this.enemies.forEach((enemy) => enemy.sprite.destroy());
    this.enemies = [];

    for (let row = 0; row < FORMATION_ROWS; row++) {
      for (let col = 0; col < FORMATION_COLS; col++) {
        const type = rowType(row);
        const baseX = FORMATION_LEFT + col * FORMATION_SPACING_X;
        const baseY = FORMATION_TOP + row * FORMATION_SPACING_Y;
        const sprite = this.physics.add.sprite(baseX, -40 - row * 20, `enemy_${type}`);
        this.enemyGroup.add(sprite);

        const enemy = { sprite, type, baseX, baseY, state: 'entering' };
        this.enemies.push(enemy);

        this.tweens.add({
          targets: sprite,
          x: baseX,
          y: baseY,
          duration: 700 + Math.random() * 500,
          delay: (row * FORMATION_COLS + col) * 40,
          ease: 'Sine.easeOut',
          onComplete: () => {
            if (enemy.state === 'entering') enemy.state = 'formation';
          },
        });
      }
    }

    this.waveText.setText(`WAVE ${this.wave}`).setAlpha(1);
    this.tweens.add({ targets: this.waveText, alpha: 0, delay: 900, duration: 500 });
  }

  update(time, delta) {
    if (this.gameOver) return;

    this.stars.tilePositionY -= delta * 0.05;

    this.handleInput(delta);
    this.updateFormationSway(time);
    this.updateDiving(time, delta);
    this.cleanupBullets();

    if (this.enemies.every((enemy) => enemy.state === 'dead')) {
      this.wave += 1;
      this.startWave();
    }
  }

  handleInput(delta) {
    let vx = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) vx += 1;
    this.player.setVelocityX(vx * PLAYER_SPEED);

    this.fireTimer -= delta;
    if (this.spaceKey.isDown && this.fireTimer <= 0) {
      this.fireTimer = PLAYER_FIRE_COOLDOWN;
      const bullet = this.physics.add.sprite(this.player.x, this.player.y - 20, 'playerBullet');
      this.playerBullets.add(bullet);
      bullet.setVelocityY(-PLAYER_BULLET_SPEED);
    }
  }

  updateFormationSway(time) {
    const offset = Math.sin(time / 900) * 24;
    for (const enemy of this.enemies) {
      if (enemy.state === 'formation') {
        enemy.sprite.x = enemy.baseX + offset;
        enemy.sprite.y = enemy.baseY;
      }
    }
  }

  updateDiving(time, delta) {
    this.diveTimer -= delta;
    if (this.diveTimer <= 0) {
      this.tryStartDive();
      this.diveTimer = Phaser.Math.Between(DIVE_MIN_DELAY, DIVE_MAX_DELAY) / Math.sqrt(this.wave);
    }

    for (const enemy of this.enemies) {
      if (enemy.state !== 'diving') continue;

      enemy.diveT += delta / DIVE_DURATION;
      if (enemy.diveT >= 1) {
        enemy.state = 'formation';
        enemy.sprite.x = enemy.baseX;
        enemy.sprite.y = enemy.baseY;
        continue;
      }

      const pos = samplePath(enemy.divePath, enemy.diveT);
      enemy.sprite.x = pos.x;
      enemy.sprite.y = pos.y;

      if (!enemy.hasFired && enemy.diveT > 0.45) {
        enemy.hasFired = true;
        this.enemyFire(enemy.sprite.x, enemy.sprite.y);
      }
    }
  }

  tryStartDive() {
    const candidates = this.enemies.filter((enemy) => enemy.state === 'formation');
    if (candidates.length === 0) return;

    const enemy = Phaser.Utils.Array.GetRandom(candidates);
    enemy.state = 'diving';
    enemy.diveT = 0;
    enemy.hasFired = false;

    const startX = enemy.baseX;
    const startY = enemy.baseY;
    const targetX = Phaser.Math.Clamp(this.player.x + Phaser.Math.Between(-40, 40), 30, WIDTH - 30);

    enemy.divePath = [
      { x: startX, y: startY },
      { x: startX + (targetX - startX) * 0.3, y: HEIGHT * 0.45 },
      { x: targetX, y: HEIGHT - 90 },
      { x: startX, y: startY },
    ];
  }

  enemyFire(x, y) {
    const bullet = this.physics.add.sprite(x, y, 'enemyBullet');
    this.enemyBullets.add(bullet);
    const angle = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
    this.physics.velocityFromRotation(angle, ENEMY_BULLET_SPEED, bullet.body.velocity);
  }

  cleanupBullets() {
    this.playerBullets.children.each((bullet) => {
      if (bullet.y < -20) bullet.destroy();
    });
    this.enemyBullets.children.each((bullet) => {
      if (bullet.y > HEIGHT + 20 || bullet.y < -20 || bullet.x < -20 || bullet.x > WIDTH + 20) bullet.destroy();
    });
  }

  killEnemy(enemy, wasDiving) {
    if (enemy.state === 'dead') return;
    enemy.state = 'dead';

    const base = ENEMY_TYPES[enemy.type].score;
    this.score += wasDiving ? base * 2 : base;
    this.scoreText.setText(`SCORE ${this.score}`);

    this.explode(enemy.sprite.x, enemy.sprite.y, ENEMY_TYPES[enemy.type].color);
    enemy.sprite.destroy();
  }

  onBulletHitEnemy(bullet, enemySprite) {
    bullet.destroy();
    const enemy = this.enemies.find((e) => e.sprite === enemySprite);
    if (!enemy) return;
    this.killEnemy(enemy, enemy.state === 'diving');
  }

  onPlayerHitByBullet(bullet) {
    bullet.destroy();
    this.damagePlayer();
  }

  onPlayerCollideEnemy(enemySprite) {
    const enemy = this.enemies.find((e) => e.sprite === enemySprite);
    if (enemy) this.killEnemy(enemy, enemy.state === 'diving');
    this.damagePlayer();
  }

  damagePlayer() {
    if (this.gameOver || this.time.now < this.invulnUntil) return;

    this.lives -= 1;
    this.updateLivesText();
    this.invulnUntil = this.time.now + 1500;
    this.explode(this.player.x, this.player.y, 0x53d0ff);

    if (this.lives <= 0) {
      this.endGame();
      return;
    }

    this.player.setPosition(WIDTH / 2, HEIGHT - 60);
    this.player.setAlpha(0.4);
    this.tweens.add({ targets: this.player, alpha: 1, duration: 1200 });
  }

  explode(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const particle = this.add.rectangle(x, y, 3, 3, color);
      const angle = Math.random() * Math.PI * 2;
      const speed = Phaser.Math.Between(40, 120);
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed,
        alpha: 0,
        duration: 350,
        onComplete: () => particle.destroy(),
      });
    }
  }

  updateLivesText() {
    this.livesText.setText(`LIVES ${'♥'.repeat(Math.max(this.lives, 0))}`);
  }

  endGame() {
    this.gameOver = true;
    this.player.setVelocity(0, 0);
    this.physics.pause();

    this.add
      .text(WIDTH / 2, HEIGHT / 2 - 20, 'GAME OVER', { fontFamily: 'monospace', fontSize: '32px', color: '#ff5555' })
      .setOrigin(0.5);
    this.add
      .text(WIDTH / 2, HEIGHT / 2 + 20, `SCORE ${this.score}  -  Press SPACE to restart`, {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.input.keyboard.once('keydown-SPACE', () => this.scene.restart());
  }
}
