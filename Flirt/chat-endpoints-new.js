// ============================================
// CHAT ENDPOINTS - DATABASE VERSION
// Replace lines 3708-4053 in server.js with this code
// ============================================

// Send a message (create or continue conversation)
app.post('/api/chat/message', optionalAuth, async (req, res) => {
    try {
        const { conversationId, guestId, source, text, stylistId } = req.body;

        // Validate text
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Message text is required' });
        }

        if (text.length > 2000) {
            return res.status(400).json({ success: false, message: 'Message too long (max 2000 characters)' });
        }

        // Rate limiting
        const rateLimitId = req.user ? req.user.id : (guestId || 'unknown');
        if (!chatRateLimiter.check(rateLimitId)) {
            return res.status(429).json({ success: false, message: 'Too many messages. Please wait a moment.' });
        }

        const now = new Date().toISOString();
        let conversation;
        let isNewConversation = false;

        if (conversationId) {
            // Find existing conversation
            conversation = await ChatRepository.findConversationById(conversationId);

            if (!conversation) {
                return res.status(404).json({ success: false, message: 'Conversation not found' });
            }

            // Verify ownership
            if (req.user) {
                if (conversation.user_id && conversation.user_id !== req.user.id) {
                    return res.status(403).json({ success: false, message: 'Access denied' });
                }
            } else {
                if (conversation.guest_id && conversation.guest_id !== guestId) {
                    return res.status(403).json({ success: false, message: 'Access denied' });
                }
            }
        } else {
            // Create new conversation
            isNewConversation = true;

            // Get user info if authenticated
            let userName = 'Guest';
            let userEmail = null;
            if (req.user) {
                try {
                    const user = await UserRepository.findById(req.user.id);
                    if (user) {
                        userName = user.name;
                        userEmail = user.email;
                    }
                } catch (error) {
                    console.error('Error fetching user for chat:', error.message);
                }
            }

            const newConvId = 'conv_' + uuidv4().substring(0, 8);
            const finalGuestId = req.user ? null : (guestId || 'guest_' + uuidv4().substring(0, 8));

            conversation = await ChatRepository.createConversation({
                id: newConvId,
                userId: req.user ? req.user.id : null,
                guestId: finalGuestId,
                userName: userName,
                userEmail: userEmail,
                source: source || 'general',
                status: 'open',
                assignedTo: stylistId || null, // Assign to stylist if specified
                unreadByAgent: 0,
                unreadByUser: 0,
                createdAt: now,
                updatedAt: now,
                lastMessageAt: now
            });

            // Add welcome message from system
            await ChatRepository.createMessage({
                id: 'msg_' + uuidv4().substring(0, 8),
                conversationId: conversation.id,
                fromType: 'system',
                text: stylistId
                    ? 'Welcome! A stylist will be with you shortly.'
                    : 'Welcome to Flirt Hair Support! How can we help you today?',
                agentId: null,
                readByAgent: 0,
                readByUser: 1, // System messages are auto-read by user
                createdAt: now
            });

            // If stylist is specified, add a system message noting the assignment
            if (stylistId) {
                try {
                    const stylist = await StylistRepository.findById(stylistId);
                    if (stylist) {
                        await ChatRepository.createMessage({
                            id: 'msg_' + uuidv4().substring(0, 8),
                            conversationId: conversation.id,
                            fromType: 'system',
                            text: `Chat requested with ${stylist.name}`,
                            agentId: null,
                            readByAgent: 0,
                            readByUser: 1,
                            createdAt: now
                        });
                    }
                } catch (error) {
                    console.error('Error fetching stylist for chat:', error.message);
                }
            }
        }

        // Add the new message
        const newMessage = await ChatRepository.createMessage({
            id: 'msg_' + uuidv4().substring(0, 8),
            conversationId: conversation.id,
            fromType: 'user',
            text: text.trim(),
            agentId: null,
            readByAgent: 0,
            readByUser: 1,
            createdAt: now
        });

        // Increment unread count for agent
        await ChatRepository.incrementUnread(conversation.id, false);

        res.json({
            success: true,
            conversation: {
                id: conversation.id,
                guestId: conversation.guest_id,
                status: conversation.status,
                lastMessageAt: now
            },
            message: {
                id: newMessage.id,
                from: newMessage.from_type,
                text: newMessage.text,
                createdAt: newMessage.created_at
            },
            isNewConversation
        });
    } catch (error) {
        console.error('Error processing chat message:', error.message);
        res.status(500).json({ success: false, message: 'Error processing message' });
    }
});

// Get a specific conversation (user)
app.get('/api/chat/conversation/:id', optionalAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { guestId } = req.query;

        const conversation = await ChatRepository.findConversationById(id);

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        // Verify ownership
        if (req.user) {
            if (conversation.user_id && conversation.user_id !== req.user.id) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        } else {
            if (conversation.guest_id && conversation.guest_id !== guestId) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        }

        // Get messages
        const messages = await ChatRepository.findMessagesByConversation(id, 100);

        // Mark messages as read by user
        await ChatRepository.markMessagesAsRead(id, false); // false = by user

        res.json({
            success: true,
            conversation: {
                id: conversation.id,
                userId: conversation.user_id,
                guestId: conversation.guest_id,
                userName: conversation.user_name,
                userEmail: conversation.user_email,
                source: conversation.source,
                status: conversation.status,
                assignedTo: conversation.assigned_to,
                createdAt: conversation.created_at,
                lastMessageAt: conversation.last_message_at,
                messages: messages.map(m => ({
                    id: m.id,
                    from: m.from_type,
                    text: m.text,
                    createdAt: m.created_at,
                    readByAgent: m.read_by_agent
                }))
            }
        });
    } catch (error) {
        console.error('Error fetching conversation:', error.message);
        res.status(500).json({ success: false, message: 'Error fetching conversation' });
    }
});

// Get user's latest conversation
app.get('/api/chat/my-latest', optionalAuth, async (req, res) => {
    try {
        const { guestId } = req.query;

        let conversation = null;

        if (req.user) {
            conversation = await ChatRepository.findLatestConversation(req.user.id, null);
        } else if (guestId) {
            conversation = await ChatRepository.findLatestConversation(null, guestId);
        }

        if (!conversation) {
            return res.json({ success: true, conversation: null });
        }

        // Get messages
        const messages = await ChatRepository.findMessagesByConversation(conversation.id, 100);

        res.json({
            success: true,
            conversation: {
                id: conversation.id,
                userId: conversation.user_id,
                guestId: conversation.guest_id,
                userName: conversation.user_name,
                userEmail: conversation.user_email,
                source: conversation.source,
                status: conversation.status,
                assignedTo: conversation.assigned_to,
                createdAt: conversation.created_at,
                lastMessageAt: conversation.last_message_at,
                messages: messages.map(m => ({
                    id: m.id,
                    from: m.from_type,
                    text: m.text,
                    createdAt: m.created_at,
                    readByAgent: m.read_by_agent
                }))
            }
        });
    } catch (error) {
        console.error('Error fetching latest conversation:', error.message);
        res.status(500).json({ success: false, message: 'Error fetching conversation' });
    }
});

// ============================================
// ADMIN CHAT ENDPOINTS
// ============================================

// Get all conversations (admin)
app.get('/api/admin/chat/conversations', authenticateAdmin, async (req, res) => {
    try {
        const { status, search, assignedTo } = req.query;

        const filters = {};
        if (status) filters.status = status;
        if (assignedTo) filters.assignedTo = assignedTo;

        let conversations = await ChatRepository.findAllConversations(filters);

        // Search filter (client-side for now, could move to DB)
        if (search) {
            const searchLower = search.toLowerCase();
            conversations = conversations.filter(c =>
                c.user_name?.toLowerCase().includes(searchLower) ||
                c.user_email?.toLowerCase().includes(searchLower)
            );
        }

        // Get unread counts
        const conversationsWithCounts = conversations.map(c => ({
            id: c.id,
            userId: c.user_id,
            guestId: c.guest_id,
            userName: c.user_name,
            userEmail: c.user_email,
            source: c.source,
            status: c.status,
            assignedTo: c.assigned_to,
            unreadCount: c.unread_by_agent,
            lastMessageAt: c.last_message_at,
            createdAt: c.created_at
        }));

        res.json({
            success: true,
            conversations: conversationsWithCounts
        });
    } catch (error) {
        console.error('Error fetching admin conversations:', error.message);
        res.status(500).json({ success: false, message: 'Error fetching conversations' });
    }
});

// Get specific conversation with messages (admin)
app.get('/api/admin/chat/conversations/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const conversation = await ChatRepository.findConversationById(id);

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        // Get messages
        const messages = await ChatRepository.findMessagesByConversation(id, 100);

        res.json({
            success: true,
            conversation: {
                id: conversation.id,
                userId: conversation.user_id,
                guestId: conversation.guest_id,
                userName: conversation.user_name,
                userEmail: conversation.user_email,
                source: conversation.source,
                status: conversation.status,
                assignedTo: conversation.assigned_to,
                unreadCount: conversation.unread_by_agent,
                createdAt: conversation.created_at,
                lastMessageAt: conversation.last_message_at,
                messages: messages.map(m => ({
                    id: m.id,
                    from: m.from_type,
                    agentId: m.agent_id,
                    text: m.text,
                    createdAt: m.created_at,
                    readByAgent: m.read_by_agent
                }))
            }
        });
    } catch (error) {
        console.error('Error fetching admin conversation:', error.message);
        res.status(500).json({ success: false, message: 'Error fetching conversation' });
    }
});

// Send message as admin/agent
app.post('/api/admin/chat/message', authenticateAdmin, async (req, res) => {
    try {
        const { conversationId, text } = req.body;

        if (!conversationId || !text || text.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Conversation ID and message text are required' });
        }

        if (text.length > 2000) {
            return res.status(400).json({ success: false, message: 'Message too long (max 2000 characters)' });
        }

        const conversation = await ChatRepository.findConversationById(conversationId);

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        const now = new Date().toISOString();

        // Create agent message
        const newMessage = await ChatRepository.createMessage({
            id: 'msg_' + uuidv4().substring(0, 8),
            conversationId: conversationId,
            fromType: 'agent',
            text: text.trim(),
            agentId: req.user.id, // Store which agent sent this
            readByAgent: 1,
            readByUser: 0,
            createdAt: now
        });

        // Increment unread count for user
        await ChatRepository.incrementUnread(conversationId, true); // true = by agent

        res.json({
            success: true,
            message: {
                id: newMessage.id,
                from: newMessage.from_type,
                agentId: newMessage.agent_id,
                text: newMessage.text,
                createdAt: newMessage.created_at
            }
        });
    } catch (error) {
        console.error('Error sending admin message:', error.message);
        res.status(500).json({ success: false, message: 'Error sending message' });
    }
});

// Mark conversation as read (admin)
app.patch('/api/admin/chat/conversations/:id/read', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const conversation = await ChatRepository.findConversationById(id);

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        // Mark all messages as read by agent
        await ChatRepository.markMessagesAsRead(id, true); // true = by agent

        res.json({
            success: true,
            message: 'Conversation marked as read'
        });
    } catch (error) {
        console.error('Error marking conversation as read:', error.message);
        res.status(500).json({ success: false, message: 'Error marking as read' });
    }
});

// Update conversation status or assignment (admin)
app.patch('/api/admin/chat/conversations/:id/status', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, assignedTo } = req.body;

        const conversation = await ChatRepository.findConversationById(id);

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        const updates = {};
        if (status) updates.status = status;
        if (assignedTo !== undefined) updates.assignedTo = assignedTo;

        const updated = await ChatRepository.updateConversation(id, updates);

        res.json({
            success: true,
            message: 'Conversation updated',
            conversation: {
                id: updated.id,
                status: updated.status,
                assignedTo: updated.assigned_to
            }
        });
    } catch (error) {
        console.error('Error updating conversation status:', error.message);
        res.status(500).json({ success: false, message: 'Error updating conversation' });
    }
});

// Get total unread count (for admin badge)
app.get('/api/admin/chat/unread-count', authenticateAdmin, async (req, res) => {
    try {
        const count = await ChatRepository.getTotalUnreadCount();
        res.json({ success: true, count });
    } catch (error) {
        console.error('Error fetching unread count:', error.message);
        res.status(500).json({ success: false, message: 'Error fetching unread count' });
    }
});
