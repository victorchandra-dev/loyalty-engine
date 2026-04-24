import {PrismaClient} from '@prisma/client';
import {PrismaSessionStorage} from '@shopify/shopify-app-session-storage-prisma';

const prisma = new PrismaClient();

export const sessionStorage = new PrismaSessionStorage(prisma);
