import { FastifyRequest, FastifyReply } from 'fastify';
import { loginSchema } from './auth.schema';
import { authService } from './auth.service';

/**
 * POST /api/v1/auth/login
 * Public endpoint to authenticate by email or credentials and retrieve a Bearer JWT.
 */
export async function handleLogin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parseResult = loginSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed for login payload',
      details: parseResult.error.format(),
    });
  }

  try {
    const result = await authService.login(parseResult.data, {
      ip: request.ip,
      userAgent: (request.headers['user-agent'] as string) ?? null,
      endpoint: request.url,
    });

    const user = result.user;
    return reply.status(200).send({
      success: true,
      message: `Successfully authenticated as ${user.full_name} (${user.role})`,
      token: result.token,
      accessToken: result.token,
      user,
      data: {
        ...user,
        user,
        token: result.token,
        accessToken: result.token,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Authentication failed';
    
    // Check for database infrastructure errors
    if (
      msg.includes('password authentication failed') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ENOTFOUND')
    ) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'DatabaseConnectionError',
        message: `Backend database connection error: ${msg}. Please verify DATABASE_URL in your Render environment variables.`,
      });
    }

    const statusCode = msg.includes('deactivated') ? 403 : msg.includes('not found') ? 404 : 401;
    return reply.status(statusCode).send({
      statusCode,
      error: statusCode === 403 ? 'Forbidden' : statusCode === 404 ? 'Not Found' : 'Unauthorized',
      message: msg,
    });
  }
}

/**
 * GET /api/v1/auth/me
 * Protected endpoint returning current user profile and tenant information.
 */
export async function handleGetMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { id: userId, tenantId } = request.user;
    const profile = await authService.getMe(userId, tenantId);

    return reply.status(200).send({
      success: true,
      user: profile,
      data: {
        ...profile,
        user: profile,
      },
    });
  } catch (err: unknown) {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: err instanceof Error ? err.message : 'User profile not found',
    });
  }
}
