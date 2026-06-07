/**
 * SemanticGraph - 语义图基础模型
 *
 * 提供图结构的数据存储和查询能力，用于表示实体之间的关系。
 * 支持与 UnifiedExporter 集成，实现基于 traceId 的上下文查询。
 *
 * 设计目标：
 * - 提供灵活的实体和关系定义
 * - 支持基本的图查询操作
 * - 与可观测性数据关联
 *
 * @see arXiv:2606.04799 - 语义图模型
 */

import { randomUUID } from "crypto"
import type { TraceContext } from "./trace-context.js"

// ─── 核心类型 ───

/**
 * 实体类型枚举
 */
export type EntityType =
  | "agent"
  | "task"
  | "evidence"
  | "metric"
  | "log"
  | "handoff"
  | "system"
  | "custom"

/**
 * 关系类型枚举
 */
export type RelationType =
  | "created_by"
  | "depends_on"
  | "triggers"
  | "contains"
  | "references"
  | "follows"
  | "precedes"
  | "caused_by"
  | "part_of"
  | "custom"

/**
 * 实体接口
 */
export interface Entity {
  /** 实体唯一标识符 */
  readonly id: string
  /** 实体类型 */
  readonly type: EntityType
  /** 实体名称 */
  readonly name: string
  /** 实体描述 */
  readonly description?: string
  /** 实体属性 */
  readonly properties: Record<string, unknown>
  /** 关联的追踪 ID */
  readonly traceId?: string
  /** 关联的 span ID */
  readonly spanId?: string
  /** 创建时间 */
  readonly createdAt: string
  /** 更新时间 */
  readonly updatedAt: string
}

/**
 * 关系接口
 */
export interface Relation {
  /** 关系唯一标识符 */
  readonly id: string
  /** 关系类型 */
  readonly type: RelationType
  /** 源实体 ID */
  readonly sourceId: string
  /** 目标实体 ID */
  readonly targetId: string
  /** 关系属性 */
  readonly properties: Record<string, unknown>
  /** 关联的追踪 ID */
  readonly traceId?: string
  /** 创建时间 */
  readonly createdAt: string
}

/**
 * 图查询过滤器
 */
export interface GraphQueryFilter {
  /** 按实体类型过滤 */
  entityType?: EntityType | EntityType[]
  /** 按关系类型过滤 */
  relationType?: RelationType | RelationType[]
  /** 按 traceId 过滤 */
  traceId?: string
  /** 按属性过滤 */
  properties?: Record<string, unknown>
  /** 按名称过滤（支持正则） */
  namePattern?: string
}

/**
 * 图查询结果
 */
export interface GraphQueryResult {
  /** 匹配的实体 */
  entities: Entity[]
  /** 匹配的关系 */
  relations: Relation[]
  /** 查询耗时（毫秒） */
  duration: number
}

/**
 * 图统计信息
 */
export interface GraphStats {
  /** 实体总数 */
  entityCount: number
  /** 关系总数 */
  relationCount: number
  /** 按实体类型统计 */
  entitiesByType: Record<EntityType, number>
  /** 按关系类型统计 */
  relationsByType: Record<RelationType, number>
  /** 唯一 traceId 数量 */
  traceIdCount: number
}

// ─── 核心实现 ───

/**
 * 语义图基础模型
 *
 * 提供图结构的数据存储和查询能力。
 */
export class SemanticGraph {
  private entities: Map<string, Entity> = new Map()
  private relations: Map<string, Relation> = new Map()
  private entityIndex: Map<EntityType, Set<string>> = new Map()
  private relationIndex: Map<RelationType, Set<string>> = new Map()
  private traceIndex: Map<string, Set<string>> = new Map()
  private sourceIndex: Map<string, Set<string>> = new Map()
  private targetIndex: Map<string, Set<string>> = new Map()

  constructor() {
    // 初始化索引
    const entityTypes: EntityType[] = [
      "agent", "task", "evidence", "metric", "log", "handoff", "system", "custom"
    ]
    const relationTypes: RelationType[] = [
      "created_by", "depends_on", "triggers", "contains", "references",
      "follows", "precedes", "caused_by", "part_of", "custom"
    ]

    for (const type of entityTypes) {
      this.entityIndex.set(type, new Set())
    }

    for (const type of relationTypes) {
      this.relationIndex.set(type, new Set())
    }
  }

  /**
   * 添加实体
   */
  addEntity(
    type: EntityType,
    name: string,
    properties: Record<string, unknown> = {},
    options?: {
      description?: string
      traceContext?: TraceContext
      id?: string
    },
  ): Entity {
    const id = options?.id ?? `entity-${randomUUID().slice(0, 12)}`
    const now = new Date().toISOString()

    const entity: Entity = {
      id,
      type,
      name,
      description: options?.description,
      properties,
      traceId: options?.traceContext?.traceId,
      spanId: options?.traceContext?.spanId,
      createdAt: now,
      updatedAt: now,
    }

    this.entities.set(id, entity)

    // 更新索引
    this.entityIndex.get(type)?.add(id)

    if (entity.traceId) {
      const traceEntities = this.traceIndex.get(entity.traceId) ?? new Set()
      traceEntities.add(id)
      this.traceIndex.set(entity.traceId, traceEntities)
    }

    return entity
  }

  /**
   * 更新实体
   */
  updateEntity(
    id: string,
    updates: {
      name?: string
      description?: string
      properties?: Record<string, unknown>
    },
  ): Entity | undefined {
    const entity = this.entities.get(id)
    if (!entity) return undefined

    const updatedEntity: Entity = {
      ...entity,
      name: updates.name ?? entity.name,
      description: updates.description ?? entity.description,
      properties: { ...entity.properties, ...updates.properties },
      updatedAt: new Date().toISOString(),
    }

    this.entities.set(id, updatedEntity)
    return updatedEntity
  }

  /**
   * 删除实体
   */
  deleteEntity(id: string): boolean {
    const entity = this.entities.get(id)
    if (!entity) return false

    // 删除实体
    this.entities.delete(id)

    // 更新索引
    this.entityIndex.get(entity.type)?.delete(id)

    if (entity.traceId) {
      this.traceIndex.get(entity.traceId)?.delete(id)
    }

    // 删除相关的关系
    const relatedRelations = new Set<string>()

    // 从源索引查找
    const sourceRelations = this.sourceIndex.get(id)
    if (sourceRelations) {
      for (const relationId of sourceRelations) {
        relatedRelations.add(relationId)
      }
    }

    // 从目标索引查找
    const targetRelations = this.targetIndex.get(id)
    if (targetRelations) {
      for (const relationId of targetRelations) {
        relatedRelations.add(relationId)
      }
    }

    // 删除关系
    for (const relationId of relatedRelations) {
      this.deleteRelation(relationId)
    }

    return true
  }

  /**
   * 添加关系
   */
  addRelation(
    type: RelationType,
    sourceId: string,
    targetId: string,
    properties: Record<string, unknown> = {},
    options?: {
      traceContext?: TraceContext
      id?: string
    },
  ): Relation | undefined {
    // 验证源实体和目标实体存在
    if (!this.entities.has(sourceId) || !this.entities.has(targetId)) {
      return undefined
    }

    const id = options?.id ?? `relation-${randomUUID().slice(0, 12)}`
    const now = new Date().toISOString()

    const relation: Relation = {
      id,
      type,
      sourceId,
      targetId,
      properties,
      traceId: options?.traceContext?.traceId,
      createdAt: now,
    }

    this.relations.set(id, relation)

    // 更新索引
    this.relationIndex.get(type)?.add(id)

    if (relation.traceId) {
      const traceRelations = this.traceIndex.get(relation.traceId) ?? new Set()
      traceRelations.add(id)
      this.traceIndex.set(relation.traceId, traceRelations)
    }

    // 更新源和目标索引
    const sourceRelations = this.sourceIndex.get(sourceId) ?? new Set()
    sourceRelations.add(id)
    this.sourceIndex.set(sourceId, sourceRelations)

    const targetRelations = this.targetIndex.get(targetId) ?? new Set()
    targetRelations.add(id)
    this.targetIndex.set(targetId, targetRelations)

    return relation
  }

  /**
   * 删除关系
   */
  deleteRelation(id: string): boolean {
    const relation = this.relations.get(id)
    if (!relation) return false

    // 删除关系
    this.relations.delete(id)

    // 更新索引
    this.relationIndex.get(relation.type)?.delete(id)

    if (relation.traceId) {
      this.traceIndex.get(relation.traceId)?.delete(id)
    }

    // 更新源和目标索引
    this.sourceIndex.get(relation.sourceId)?.delete(id)
    this.targetIndex.get(relation.targetId)?.delete(id)

    return true
  }

  /**
   * 获取实体
   */
  getEntity(id: string): Entity | undefined {
    return this.entities.get(id)
  }

  /**
   * 获取关系
   */
  getRelation(id: string): Relation | undefined {
    return this.relations.get(id)
  }

  /**
   * 查询实体
   */
  queryEntities(filter?: GraphQueryFilter): Entity[] {
    let entities = Array.from(this.entities.values())

    if (!filter) return entities

    // 按实体类型过滤
    if (filter.entityType) {
      const types = Array.isArray(filter.entityType) ? filter.entityType : [filter.entityType]
      entities = entities.filter(entity => types.includes(entity.type))
    }

    // 按 traceId 过滤
    if (filter.traceId) {
      entities = entities.filter(entity => entity.traceId === filter.traceId)
    }

    // 按属性过滤
    if (filter.properties) {
      entities = entities.filter(entity => {
        for (const [key, value] of Object.entries(filter.properties!)) {
          if (entity.properties[key] !== value) {
            return false
          }
        }
        return true
      })
    }

    // 按名称过滤
    if (filter.namePattern) {
      const regex = new RegExp(filter.namePattern)
      entities = entities.filter(entity => regex.test(entity.name))
    }

    return entities
  }

  /**
   * 查询关系
   */
  queryRelations(filter?: GraphQueryFilter): Relation[] {
    let relations = Array.from(this.relations.values())

    if (!filter) return relations

    // 按关系类型过滤
    if (filter.relationType) {
      const types = Array.isArray(filter.relationType) ? filter.relationType : [filter.relationType]
      relations = relations.filter(relation => types.includes(relation.type))
    }

    // 按 traceId 过滤
    if (filter.traceId) {
      relations = relations.filter(relation => relation.traceId === filter.traceId)
    }

    // 按属性过滤
    if (filter.properties) {
      relations = relations.filter(relation => {
        for (const [key, value] of Object.entries(filter.properties!)) {
          if (relation.properties[key] !== value) {
            return false
          }
        }
        return true
      })
    }

    return relations
  }

  /**
   * 查询图
   */
  queryGraph(filter?: GraphQueryFilter): GraphQueryResult {
    const startTime = performance.now()

    const entities = this.queryEntities(filter)
    const relations = this.queryRelations(filter)

    const duration = performance.now() - startTime

    return {
      entities,
      relations,
      duration,
    }
  }

  /**
   * 通过 traceId 查询相关实体和关系
   */
  queryByTraceId(traceId: string): GraphQueryResult {
    return this.queryGraph({ traceId })
  }

  /**
   * 获取实体的邻居实体
   */
  getNeighbors(
    entityId: string,
    options?: {
      direction?: "outgoing" | "incoming" | "both"
      relationTypes?: RelationType[]
      entityTypes?: EntityType[]
    },
  ): Entity[] {
    const direction = options?.direction ?? "both"
    const neighbors: Entity[] = []
    const visited = new Set<string>()

    // 获取 outgoing 关系
    if (direction === "outgoing" || direction === "both") {
      const outgoingRelations = this.sourceIndex.get(entityId)
      if (outgoingRelations) {
        for (const relationId of outgoingRelations) {
          const relation = this.relations.get(relationId)
          if (!relation) continue

          // 按关系类型过滤
          if (options?.relationTypes && !options.relationTypes.includes(relation.type)) {
            continue
          }

          const targetEntity = this.entities.get(relation.targetId)
          if (!targetEntity) continue

          // 按实体类型过滤
          if (options?.entityTypes && !options.entityTypes.includes(targetEntity.type)) {
            continue
          }

          if (!visited.has(targetEntity.id)) {
            visited.add(targetEntity.id)
            neighbors.push(targetEntity)
          }
        }
      }
    }

    // 获取 incoming 关系
    if (direction === "incoming" || direction === "both") {
      const incomingRelations = this.targetIndex.get(entityId)
      if (incomingRelations) {
        for (const relationId of incomingRelations) {
          const relation = this.relations.get(relationId)
          if (!relation) continue

          // 按关系类型过滤
          if (options?.relationTypes && !options.relationTypes.includes(relation.type)) {
            continue
          }

          const sourceEntity = this.entities.get(relation.sourceId)
          if (!sourceEntity) continue

          // 按实体类型过滤
          if (options?.entityTypes && !options.entityTypes.includes(sourceEntity.type)) {
            continue
          }

          if (!visited.has(sourceEntity.id)) {
            visited.add(sourceEntity.id)
            neighbors.push(sourceEntity)
          }
        }
      }
    }

    return neighbors
  }

  /**
   * 获取实体的关系
   */
  getEntityRelations(
    entityId: string,
    options?: {
      direction?: "outgoing" | "incoming" | "both"
      relationTypes?: RelationType[]
    },
  ): Relation[] {
    const direction = options?.direction ?? "both"
    const relations: Relation[] = []
    const visited = new Set<string>()

    // 获取 outgoing 关系
    if (direction === "outgoing" || direction === "both") {
      const outgoingRelations = this.sourceIndex.get(entityId)
      if (outgoingRelations) {
        for (const relationId of outgoingRelations) {
          const relation = this.relations.get(relationId)
          if (!relation) continue

          // 按关系类型过滤
          if (options?.relationTypes && !options.relationTypes.includes(relation.type)) {
            continue
          }

          if (!visited.has(relation.id)) {
            visited.add(relation.id)
            relations.push(relation)
          }
        }
      }
    }

    // 获取 incoming 关系
    if (direction === "incoming" || direction === "both") {
      const incomingRelations = this.targetIndex.get(entityId)
      if (incomingRelations) {
        for (const relationId of incomingRelations) {
          const relation = this.relations.get(relationId)
          if (!relation) continue

          // 按关系类型过滤
          if (options?.relationTypes && !options.relationTypes.includes(relation.type)) {
            continue
          }

          if (!visited.has(relation.id)) {
            visited.add(relation.id)
            relations.push(relation)
          }
        }
      }
    }

    return relations
  }

  /**
   * 获取图统计信息
   */
  getStats(): GraphStats {
    const entitiesByType: Record<EntityType, number> = {
      agent: 0,
      task: 0,
      evidence: 0,
      metric: 0,
      log: 0,
      handoff: 0,
      system: 0,
      custom: 0,
    }

    const relationsByType: Record<RelationType, number> = {
      created_by: 0,
      depends_on: 0,
      triggers: 0,
      contains: 0,
      references: 0,
      follows: 0,
      precedes: 0,
      caused_by: 0,
      part_of: 0,
      custom: 0,
    }

    for (const entity of this.entities.values()) {
      entitiesByType[entity.type]++
    }

    for (const relation of this.relations.values()) {
      relationsByType[relation.type]++
    }

    return {
      entityCount: this.entities.size,
      relationCount: this.relations.size,
      entitiesByType,
      relationsByType,
      traceIdCount: this.traceIndex.size,
    }
  }

  /**
   * 清空图
   */
  clear(): void {
    this.entities.clear()
    this.relations.clear()

    // 清空索引
    for (const index of this.entityIndex.values()) {
      index.clear()
    }
    for (const index of this.relationIndex.values()) {
      index.clear()
    }
    this.traceIndex.clear()
    this.sourceIndex.clear()
    this.targetIndex.clear()
  }

  /**
   * 导出为 JSON
   */
  export(): {
    entities: Entity[]
    relations: Relation[]
  } {
    return {
      entities: Array.from(this.entities.values()),
      relations: Array.from(this.relations.values()),
    }
  }

  /**
   * 从 JSON 导入
   */
  import(data: {
    entities: Entity[]
    relations: Relation[]
  }): void {
    this.clear()

    // 导入实体
    for (const entity of data.entities) {
      this.entities.set(entity.id, entity)
      this.entityIndex.get(entity.type)?.add(entity.id)

      if (entity.traceId) {
        const traceEntities = this.traceIndex.get(entity.traceId) ?? new Set()
        traceEntities.add(entity.id)
        this.traceIndex.set(entity.traceId, traceEntities)
      }
    }

    // 导入关系
    for (const relation of data.relations) {
      this.relations.set(relation.id, relation)
      this.relationIndex.get(relation.type)?.add(relation.id)

      if (relation.traceId) {
        const traceRelations = this.traceIndex.get(relation.traceId) ?? new Set()
        traceRelations.add(relation.id)
        this.traceIndex.set(relation.traceId, traceRelations)
      }

      // 更新源和目标索引
      const sourceRelations = this.sourceIndex.get(relation.sourceId) ?? new Set()
      sourceRelations.add(relation.id)
      this.sourceIndex.set(relation.sourceId, sourceRelations)

      const targetRelations = this.targetIndex.get(relation.targetId) ?? new Set()
      targetRelations.add(relation.id)
      this.targetIndex.set(relation.targetId, targetRelations)
    }
  }
}

// ─── 全局实例 ───

let globalGraph: SemanticGraph | null = null

/**
 * 获取全局 SemanticGraph 实例
 */
export function getGlobalGraph(): SemanticGraph {
  if (!globalGraph) {
    globalGraph = new SemanticGraph()
  }
  return globalGraph
}

/**
 * 初始化全局 SemanticGraph
 */
export function initGlobalGraph(): SemanticGraph {
  globalGraph = new SemanticGraph()
  return globalGraph
}

/**
 * 设置全局 SemanticGraph
 */
export function setGlobalGraph(graph: SemanticGraph): void {
  globalGraph = graph
}

// ─── 工具函数 ───

/**
 * 创建实体类型过滤器
 */
export function createEntityTypeFilter(...types: EntityType[]): GraphQueryFilter {
  return {
    entityType: types.length === 1 ? types[0] : types,
  }
}

/**
 * 创建关系类型过滤器
 */
export function createRelationTypeFilter(...types: RelationType[]): GraphQueryFilter {
  return {
    relationType: types.length === 1 ? types[0] : types,
  }
}

/**
 * 创建 traceId 过滤器
 */
export function createTraceIdFilter(traceId: string): GraphQueryFilter {
  return {
    traceId,
  }
}