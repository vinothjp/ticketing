import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { mkdirSync } from 'fs';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  mkdirSync(join(process.cwd(), 'uploads/logos'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads/tickets'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads/messages'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads/kb'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads/projects'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads/change-requests'), { recursive: true });
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:3001'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);
}
bootstrap();
