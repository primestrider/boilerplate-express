import { HttpError } from "../../shared/errors/http-error";
import { paginate, type Paginated } from "../../shared/http/pagination";
import type { AuditService } from "../audit/audit.service";
import type {
  CreateUserInput,
  FindUsersInput,
  UpdateUserInput,
  User,
  UserRole,
} from "./user.entity";
import type { UserRepository } from "./user.repository";

const userNotFound = () =>
  HttpError.notFound("User not found", { errorCode: "USER_NOT_FOUND" });

const emailTaken = () =>
  HttpError.conflict("Email already exists", {
    errorCode: "EMAIL_ALREADY_EXISTS",
  });

/**
 * Contains user business rules.
 *
 * Controllers handle HTTP concerns (including who may call what), repositories
 * handle persistence, and this service keeps the actual user workflow in one
 * place.
 */
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Returns a filtered, sorted page of users.
   */
  async findAll(input: FindUsersInput): Promise<Paginated<User>> {
    const { users, total } = await this.userRepository.findAll(input);
    return paginate(users, total, input);
  }

  /**
   * Returns a single user or throws a domain-friendly not found error.
   */
  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);

    if (!user) throw userNotFound();

    return user;
  }

  /**
   * Creates a user after enforcing email uniqueness.
   */
  async create(input: CreateUserInput): Promise<User> {
    if (await this.userRepository.isEmailTaken(input.email)) {
      throw emailTaken();
    }

    return this.userRepository.create(input);
  }

  /**
   * Updates profile fields. A new email must not belong to anyone else.
   */
  async update(id: string, input: UpdateUserInput): Promise<User> {
    if (
      input.email !== undefined &&
      (await this.userRepository.isEmailTaken(input.email, id))
    ) {
      throw emailTaken();
    }

    const user = await this.userRepository.update(id, input);

    if (!user) throw userNotFound();

    await this.auditService.record({
      action: "user.updated",
      entityType: "user",
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });

    return user;
  }

  /**
   * Changes a user's role. Admins cannot change their own role, so the last
   * admin cannot lock everyone out by demoting themselves.
   */
  async changeRole(actorId: string, id: string, role: UserRole): Promise<User> {
    if (actorId === id) {
      throw HttpError.badRequest("You cannot change your own role", {
        errorCode: "CANNOT_CHANGE_OWN_ROLE",
      });
    }

    const user = await this.findById(id);
    const previousRole = user.role;

    if (previousRole === role) return user;

    await this.userRepository.updateRole(id, role);
    await this.auditService.record({
      action: "user.role_changed",
      entityType: "user",
      entityId: id,
      metadata: { from: previousRole, to: role },
    });

    return { ...user, role };
  }

  /**
   * Soft-deletes a user. The account can no longer log in or refresh tokens;
   * access tokens already issued expire on their own (JWT_TTL_SECONDS).
   */
  async delete(id: string): Promise<void> {
    if (!(await this.userRepository.softDelete(id))) throw userNotFound();

    await this.auditService.record({
      action: "user.deleted",
      entityType: "user",
      entityId: id,
    });
  }
}
